import { beforeEach, describe, expect, it } from 'vitest'
import { readerDb } from '../../src/app/state/reader-db'
import { localState } from '../../src/app/state/local-state'
import { reconcileActiveOfflinePointer, writeActiveOfflinePointer, type ActiveOfflinePointer } from '../../src/pwa/offline-pointer'

class MemoryCacheStorage {
  private readonly entries = new Map<string, Response>()
  async open(): Promise<Cache> {
    return {
      match: async (request) => this.entries.get(String(request))?.clone(),
      put: async (request, response) => { this.entries.set(String(request), response.clone()) },
    } as Cache
  }
}

describe('offline active pointer', () => {
  beforeEach(async () => {
    await readerDb.delete()
    await readerDb.open()
  })

  it('uses Cache Storage as the source of truth when the Dexie mirror conflicts', async () => {
    const storage = new MemoryCacheStorage()
    const pointer: ActiveOfflinePointer = { content_version: '2026.07.30-01', manifest_fingerprint: 'a'.repeat(64), cache_name: 'myriad-content-a', activated_at: '2026-07-30T00:00:00.000Z' }
    await writeActiveOfflinePointer(pointer, storage)
    await localState.mirrorAppMeta('offline.active', { ...pointer, manifest_fingerprint: 'b'.repeat(64), cache_name: 'myriad-content-b' })

    const result = await reconcileActiveOfflinePointer(storage)
    expect(result).toMatchObject({ pointer, warning: expect.stringContaining('Cache Storage') })
    expect(await localState.getAppMeta('offline.active')).toEqual(pointer)
    expect((await localState.getAppMeta<{ warning: string | null }>('offline.last-check'))?.warning).toContain('Cache Storage')
  })
})
