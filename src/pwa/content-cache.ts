import { ACTIVE_POINTER_URL, CONTENT_CACHE_PREFIX, CONTENT_META_CACHE, isActiveContentPointer, type ActiveContentPointer } from './cache-protocol'

export type ContentCacheStorage = Pick<CacheStorage, 'keys' | 'open' | 'delete'>

function cacheStorageOrThrow(cacheStorage: ContentCacheStorage | undefined): ContentCacheStorage {
  if (!cacheStorage) throw new Error('Cache Storage is unavailable.')
  return cacheStorage
}

export async function readActivePointer(cacheStorage: ContentCacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches): Promise<ActiveContentPointer | undefined> {
  if (!cacheStorage) return undefined
  try {
    const response = await (await cacheStorage.open(CONTENT_META_CACHE)).match(ACTIVE_POINTER_URL)
    if (!response) return undefined
    const value: unknown = await response.json()
    return isActiveContentPointer(value) ? value : undefined
  } catch {
    return undefined
  }
}

export async function writeActivePointer(pointer: ActiveContentPointer, cacheStorage: ContentCacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches): Promise<void> {
  const storage = cacheStorageOrThrow(cacheStorage)
  if (!isActiveContentPointer(pointer)) throw new Error('Invalid active content pointer.')
  if (!(await storage.keys()).includes(pointer.cache_name)) throw new Error('Active content cache does not exist.')
  await (await storage.open(CONTENT_META_CACHE)).put(ACTIVE_POINTER_URL, new Response(JSON.stringify(pointer), {
    headers: { 'Content-Type': 'application/json' },
  }))
}

export async function restorePreviousPointer(pointer: ActiveContentPointer, cacheStorage: ContentCacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches): Promise<void> {
  await writeActivePointer(pointer, cacheStorage)
}

export async function listContentCaches(cacheStorage: ContentCacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches): Promise<string[]> {
  if (!cacheStorage) return []
  return (await cacheStorage.keys()).filter((name) => name.startsWith(CONTENT_CACHE_PREFIX)).sort()
}

export async function deleteCandidateCache(cacheName: string, retainCacheNames: Iterable<string> = [], cacheStorage: ContentCacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches): Promise<boolean> {
  const storage = cacheStorageOrThrow(cacheStorage)
  if (!cacheName.startsWith(CONTENT_CACHE_PREFIX)) return false
  const pointer = await readActivePointer(storage)
  const retained = new Set(retainCacheNames)
  if (pointer?.cache_name === cacheName || retained.has(cacheName)) return false
  return storage.delete(cacheName)
}

export async function deleteOrphanCaches(retainCacheNames: Iterable<string>, cacheStorage: ContentCacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches): Promise<string[]> {
  const storage = cacheStorageOrThrow(cacheStorage)
  const removed: string[] = []
  for (const cacheName of await listContentCaches(storage)) {
    if (await deleteCandidateCache(cacheName, retainCacheNames, storage)) removed.push(cacheName)
  }
  return removed
}
