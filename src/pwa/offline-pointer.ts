import { localState } from '../app/state/local-state'
import { ACTIVE_POINTER_URL, type ActiveContentPointer } from './cache-protocol'
import { readActivePointer, writeActivePointer, type ContentCacheStorage } from './content-cache'

export { ACTIVE_POINTER_URL }
export type ActiveOfflinePointer = ActiveContentPointer

export interface OfflinePointerSyncResult {
  pointer?: ActiveContentPointer
  warning?: string
}

export async function readActiveOfflinePointer(cacheStorage?: ContentCacheStorage): Promise<ActiveContentPointer | undefined> {
  return readActivePointer(cacheStorage)
}

export async function writeActiveOfflinePointer(pointer: ActiveContentPointer, cacheStorage?: ContentCacheStorage): Promise<void> {
  await writeActivePointer(pointer, cacheStorage)
  await localState.mirrorAppMeta('offline.active', pointer)
}

export async function reconcileActiveOfflinePointer(cacheStorage?: ContentCacheStorage): Promise<OfflinePointerSyncResult> {
  const pointer = await readActivePointer(cacheStorage)
  const mirror = await localState.getAppMeta<unknown>('offline.active')
  let warning: string | undefined
  if (pointer) {
    if (typeof mirror === 'object' && mirror !== null && 'cache_name' in mirror && (mirror.cache_name !== pointer.cache_name || !('manifest_fingerprint' in mirror) || mirror.manifest_fingerprint !== pointer.manifest_fingerprint)) {
      warning = '离线版本元数据与 Cache Storage 指针不一致；已以 Cache Storage 为准。'
    }
    await localState.mirrorAppMeta('offline.active', pointer)
  } else if (mirror) {
    warning = '离线版本镜像存在，但 Cache Storage 未找到活动指针。'
  }
  await localState.mirrorAppMeta('offline.last-check', { checked_at: new Date().toISOString(), warning: warning ?? null })
  return { pointer, warning }
}
