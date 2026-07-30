import { deleteOrphanCaches, readActivePointer, type ContentCacheStorage } from '../content-cache'

/** Removes only unreferenced versioned content caches; Workbox and active caches are untouched. */
export async function cleanupTemporaryContentCaches(cacheStorage: ContentCacheStorage): Promise<string[]> {
  const active = await readActivePointer(cacheStorage)
  return deleteOrphanCaches(active ? [active.cache_name] : [], cacheStorage)
}
