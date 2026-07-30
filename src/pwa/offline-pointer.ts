import { basePath } from '../lib/base-path'
import { localState } from '../app/state/local-state'

export const OFFLINE_META_CACHE = 'myriad-atlas-offline-meta-v1'
export const ACTIVE_POINTER_URL = basePath('__offline/active.json')

export interface ActiveOfflinePointer {
  content_version: string
  manifest_fingerprint: string
  cache_name: string
  activated_at: string
}

export interface OfflinePointerSyncResult {
  pointer?: ActiveOfflinePointer
  warning?: string
}

interface CacheStorageLike {
  open(name: string): Promise<Pick<Cache, 'match' | 'put'>>
}

function isActivePointer(value: unknown): value is ActiveOfflinePointer {
  return typeof value === 'object' && value !== null
    && 'content_version' in value && typeof value.content_version === 'string'
    && 'manifest_fingerprint' in value && typeof value.manifest_fingerprint === 'string'
    && 'cache_name' in value && typeof value.cache_name === 'string'
    && 'activated_at' in value && typeof value.activated_at === 'string'
}

export async function readActiveOfflinePointer(cacheStorage: CacheStorageLike | undefined = typeof caches === 'undefined' ? undefined : caches): Promise<ActiveOfflinePointer | undefined> {
  if (!cacheStorage) return undefined
  try {
    const response = await (await cacheStorage.open(OFFLINE_META_CACHE)).match(ACTIVE_POINTER_URL)
    if (!response) return undefined
    const value: unknown = await response.json()
    return isActivePointer(value) ? value : undefined
  } catch {
    return undefined
  }
}

export async function writeActiveOfflinePointer(pointer: ActiveOfflinePointer, cacheStorage: CacheStorageLike | undefined = typeof caches === 'undefined' ? undefined : caches): Promise<void> {
  if (!cacheStorage) throw new Error('Cache Storage is unavailable.')
  await (await cacheStorage.open(OFFLINE_META_CACHE)).put(ACTIVE_POINTER_URL, new Response(JSON.stringify(pointer), {
    headers: { 'Content-Type': 'application/json' },
  }))
  await localState.mirrorAppMeta('offline.active', pointer)
}

export async function reconcileActiveOfflinePointer(cacheStorage: CacheStorageLike | undefined = typeof caches === 'undefined' ? undefined : caches): Promise<OfflinePointerSyncResult> {
  const pointer = await readActiveOfflinePointer(cacheStorage)
  const mirror = await localState.getAppMeta<unknown>('offline.active')
  let warning: string | undefined
  if (pointer) {
    if (isActivePointer(mirror) && (mirror.cache_name !== pointer.cache_name || mirror.manifest_fingerprint !== pointer.manifest_fingerprint)) {
      warning = '离线版本元数据与 Cache Storage 指针不一致；已以 Cache Storage 为准。'
    }
    await localState.mirrorAppMeta('offline.active', pointer)
  } else if (isActivePointer(mirror)) {
    warning = '离线版本镜像存在，但 Cache Storage 未找到活动指针。'
  }
  await localState.mirrorAppMeta('offline.last-check', { checked_at: new Date().toISOString(), warning: warning ?? null })
  return { pointer, warning }
}
