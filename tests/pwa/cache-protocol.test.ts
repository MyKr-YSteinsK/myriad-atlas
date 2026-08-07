import { describe, expect, it, vi } from 'vitest'
import { ACTIVE_POINTER_URL, CONTENT_CACHE_MESSAGES, CONTENT_META_CACHE, canonicalContentPath, contentCacheName, hasNetworkBypass, isKnowledgeOwnedRuntimePath, withNetworkBypass } from '../../src/pwa/cache-protocol'
import { deleteCandidateCache, deleteOrphanCaches, listContentCaches, readActivePointer, writeActivePointer } from '../../src/pwa/content-cache'
import { VersionedContentHandler } from '../../src/pwa/worker-content-handler'

class MemoryCacheStorage {
  private readonly entries = new Map<string, Map<string, Response>>()
  async keys(): Promise<string[]> { return [...this.entries.keys()] }
  async delete(name: string): Promise<boolean> { return this.entries.delete(name) }
  async open(name: string): Promise<Cache> {
    const values = this.entries.get(name) ?? new Map<string, Response>()
    this.entries.set(name, values)
    return {
      match: async (request) => values.get(String(request))?.clone(),
      put: async (request, response) => { values.set(String(request), response.clone()) },
    } as Cache
  }
}

const origin = 'https://example.test'
const fingerprint = 'a'.repeat(64)
const pointer = {
  schema_version: 1 as const,
  content_version: '2026.07.30-01', manifest_fingerprint: fingerprint,
  cache_name: contentCacheName('2026.07.30-01', fingerprint), activated_at: '2026-07-30T00:00:00.000Z',
}

async function putPointer(storage: MemoryCacheStorage, value = pointer): Promise<void> {
  await storage.open(value.cache_name)
  await writeActivePointer(value, storage)
}

describe('versioned content cache protocol', () => {
  it('canonicalizes only scoped generated/media paths and preserves Hash-router resource URLs', () => {
    expect(canonicalContentPath(`${origin}/myriad-atlas/_generated/pagefind/pagefind.js?x=1#hash`, origin)).toBe('/myriad-atlas/_generated/pagefind/pagefind.js')
    expect(canonicalContentPath(`${origin}/myriad-atlas/media/figure.png`, origin)).toBe('/myriad-atlas/media/figure.png')
    expect(isKnowledgeOwnedRuntimePath(`${origin}/myriad-atlas/_generated/app-changelog.json`, origin)).toBe(false)
    expect(canonicalContentPath(`${origin}/myriad-atlas/#/node/example`, origin)).toBeUndefined()
    expect(canonicalContentPath('https://other.test/myriad-atlas/_generated/catalog.json', origin)).toBeUndefined()
    const bypass = withNetworkBypass('/myriad-atlas/_generated/catalog.json', 'download-1')
    expect(hasNetworkBypass(bypass)).toBe(true)
    expect(canonicalContentPath(bypass)).toBe('/myriad-atlas/_generated/catalog.json')
    expect(() => withNetworkBypass('https://other.test/myriad-atlas/_generated/catalog.json', 'download-1')).toThrow()
  })

  it('validates pointers and keeps active and Workbox caches during cleanup', async () => {
    const storage = new MemoryCacheStorage()
    await expect(writeActivePointer({ ...pointer, cache_name: 'invalid' }, storage)).rejects.toThrow('Invalid')
    await expect(writeActivePointer(pointer, storage)).rejects.toThrow('does not exist')
    await storage.open(pointer.cache_name)
    const candidate = contentCacheName('2026.07.31-01', 'b'.repeat(64))
    await storage.open(candidate)
    await storage.open('workbox-precache-v2')
    await writeActivePointer(pointer, storage)
    await expect(readActivePointer(storage)).resolves.toEqual(pointer)
    expect(await listContentCaches(storage)).toEqual([pointer.cache_name, candidate])
    expect(await deleteCandidateCache(pointer.cache_name, [], storage)).toBe(false)
    expect(await deleteOrphanCaches([], storage)).toEqual([candidate])
    expect(await storage.keys()).toEqual(expect.arrayContaining([pointer.cache_name, 'workbox-precache-v2']))
  })

  it('normalizes v0 pointers but rejects future pointer schemas in both window and worker reads', async () => {
    const storage = new MemoryCacheStorage()
    await storage.open(pointer.cache_name)
    const legacyPointer = { ...pointer }
    delete (legacyPointer as { schema_version?: number }).schema_version
    await (await storage.open(CONTENT_META_CACHE)).put(ACTIVE_POINTER_URL, new Response(JSON.stringify(legacyPointer)))
    await expect(readActivePointer(storage)).resolves.toEqual(pointer)

    const handler = new VersionedContentHandler(origin, storage, vi.fn(async () => new Response('network')))
    await (await storage.open(pointer.cache_name)).put('/myriad-atlas/_generated/catalog.json', new Response('active'))
    await expect((await handler.handle(new Request(`${origin}/myriad-atlas/_generated/catalog.json`))).text()).resolves.toBe('active')

    await (await storage.open(CONTENT_META_CACHE)).put(ACTIVE_POINTER_URL, new Response(JSON.stringify({ ...pointer, schema_version: 2 })))
    handler.resetPointer()
    expect((await handler.handle(new Request(`${origin}/myriad-atlas/_generated/catalog.json`))).status).toBe(503)
    await expect(readActivePointer(storage)).resolves.toBeUndefined()
  })

  it('uses network only without a pointer, otherwise serves exactly the active cache', async () => {
    const storage = new MemoryCacheStorage()
    const fetcher = vi.fn(async () => new Response('network'))
    const handler = new VersionedContentHandler(origin, storage, fetcher)
    const catalog = new Request(`${origin}/myriad-atlas/_generated/catalog.json`)
    await expect((await handler.handle(catalog)).text()).resolves.toBe('network')
    expect(fetcher).toHaveBeenCalledTimes(1)

    await putPointer(storage)
    const activeCache = await storage.open(pointer.cache_name)
    await activeCache.put('/myriad-atlas/_generated/catalog.json', new Response('active'))
    handler.resetPointer()
    await expect((await handler.handle(catalog)).text()).resolves.toBe('active')
    expect(fetcher).toHaveBeenCalledTimes(1)

    const missing = await handler.handle(new Request(`${origin}/myriad-atlas/_generated/nodes/missing.json`))
    expect(missing.status).toBe(503)
    expect(missing.headers.get('X-Myriad-Offline')).toBe('active-cache-miss')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps the app changelog in the application shell even for legacy active caches', async () => {
    const storage = new MemoryCacheStorage()
    await putPointer(storage)
    const activeCache = await storage.open(pointer.cache_name)
    await activeCache.put('/myriad-atlas/_generated/app-changelog.json', new Response('legacy-app-log'))
    const fetcher = vi.fn(async () => new Response('shell-app-log'))
    const handler = new VersionedContentHandler(origin, storage, fetcher)
    const request = new Request(`${origin}/myriad-atlas/_generated/app-changelog.json`)

    expect(handler.matches(new URL(request.url))).toBe(false)
    await expect((await handler.handle(request)).text()).resolves.toBe('shell-app-log')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('supports bypass, media/Pagefind, invalid pointers, and pointer refresh messages', async () => {
    const storage = new MemoryCacheStorage()
    await putPointer(storage)
    const activeCache = await storage.open(pointer.cache_name)
    await activeCache.put('/myriad-atlas/media/figure.png', new Response('media'))
    await activeCache.put('/myriad-atlas/_generated/pagefind/entry.woff', new Response('pagefind'))
    const fetcher = vi.fn(async () => new Response('network'))
    const handler = new VersionedContentHandler(origin, storage, fetcher)
    await expect((await handler.handle(new Request(`${origin}/myriad-atlas/media/figure.png`))).text()).resolves.toBe('media')
    await expect((await handler.handle(new Request(`${origin}/myriad-atlas/_generated/pagefind/entry.woff`))).text()).resolves.toBe('pagefind')
    await expect((await handler.handle(new Request(`${origin}${withNetworkBypass('/myriad-atlas/media/figure.png', 'fresh')}`))).text()).resolves.toBe('network')
    expect(fetcher).toHaveBeenCalledOnce()

    await (await storage.open(CONTENT_META_CACHE)).put(ACTIVE_POINTER_URL, new Response(JSON.stringify({ ...pointer, cache_name: 'bad' })))
    handler.resetPointer()
    expect((await handler.handle(new Request(`${origin}/myriad-atlas/_generated/catalog.json`))).status).toBe(503)
    await (await storage.open(CONTENT_META_CACHE)).put(ACTIVE_POINTER_URL, new Response(JSON.stringify(pointer)))
    handler.resetPointer()
    await activeCache.put('/myriad-atlas/_generated/catalog.json', new Response(CONTENT_CACHE_MESSAGES.activated))
    await expect((await handler.handle(new Request(`${origin}/myriad-atlas/_generated/catalog.json`))).text()).resolves.toBe(CONTENT_CACHE_MESSAGES.activated)
  })
})
