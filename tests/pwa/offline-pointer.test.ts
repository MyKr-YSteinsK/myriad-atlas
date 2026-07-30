import { beforeEach, describe, expect, it } from 'vitest'
import { readerDb } from '../../src/app/state/reader-db'
import { localState } from '../../src/app/state/local-state'
import { reconcileActiveOfflinePointer, writeActiveOfflinePointer, type ActiveOfflinePointer } from '../../src/pwa/offline-pointer'
import { ACTIVE_POINTER_URL, CONTENT_META_CACHE, contentCacheName } from '../../src/pwa/cache-protocol'

class MemoryCacheStorage {
  private readonly caches = new Map<string, Map<string, Response>>()
  async open(name: string): Promise<Cache> {
    const entries = this.caches.get(name) ?? new Map<string, Response>()
    this.caches.set(name, entries)
    return {
      match: async (request) => entries.get(String(request))?.clone(),
      put: async (request, response) => { entries.set(String(request), response.clone()) },
    } as Cache
  }
  async keys(): Promise<string[]> { return [...this.caches.keys()] }
  async delete(name: string): Promise<boolean> { return this.caches.delete(name) }
}

describe('offline active pointer', () => {
  beforeEach(async () => {
    await readerDb.delete()
    await readerDb.open()
  })

  it('uses Cache Storage as the source of truth when the Dexie mirror conflicts', async () => {
    const storage = new MemoryCacheStorage()
    const pointer: ActiveOfflinePointer = { schema_version: 1, content_version: '2026.07.30-01', manifest_fingerprint: 'a'.repeat(64), cache_name: contentCacheName('2026.07.30-01', 'a'.repeat(64)), activated_at: '2026-07-30T00:00:00.000Z' }
    await storage.open(pointer.cache_name)
    await writeActiveOfflinePointer(pointer, storage)
    await localState.mirrorAppMeta('offline.active', { ...pointer, manifest_fingerprint: 'b'.repeat(64), cache_name: 'myriad-content-b' })

    const result = await reconcileActiveOfflinePointer(storage)
    expect(result).toMatchObject({ pointer, warning: expect.stringContaining('Cache Storage') })
    expect(await localState.getAppMeta('offline.active')).toEqual(pointer)
    expect((await localState.getAppMeta<{ warning: string | null }>('offline.last-check'))?.warning).toContain('Cache Storage')
  })

  it('normalizes a legacy Cache Storage pointer before mirroring it to Dexie', async () => {
    const storage = new MemoryCacheStorage()
    const pointer: ActiveOfflinePointer = { schema_version: 1, content_version: '2026.07.30-01', manifest_fingerprint: 'a'.repeat(64), cache_name: contentCacheName('2026.07.30-01', 'a'.repeat(64)), activated_at: '2026-07-30T00:00:00.000Z' }
    await storage.open(pointer.cache_name)
    const legacyPointer = { ...pointer }
    delete (legacyPointer as { schema_version?: number }).schema_version
    await (await storage.open(CONTENT_META_CACHE)).put(ACTIVE_POINTER_URL, new Response(JSON.stringify(legacyPointer)))

    await expect(reconcileActiveOfflinePointer(storage)).resolves.toMatchObject({ pointer })
    expect(await localState.getAppMeta('offline.active')).toEqual(pointer)
  })
})
