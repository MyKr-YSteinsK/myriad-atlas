import { basePath } from '../../lib/base-path'
import { ACTIVE_POINTER_URL, CONTENT_META_CACHE, normalizeActiveContentPointer, type ActiveContentPointer } from '../cache-protocol'
import { type ContentCacheStorage } from '../content-cache'
import { isDownloadManifest, sha256, type DownloadManifest } from '../download/content-download'

export type ActiveContentHealth = 'healthy' | 'missing' | 'corrupt' | 'version-mismatch' | 'pointer-invalid'

export interface ActiveContentVerification {
  status: ActiveContentHealth
  pointer?: ActiveContentPointer
  manifest?: DownloadManifest
  path?: string
  message: string
}

function cachePath(request: Request): string {
  return new URL(request.url).pathname
}

/**
 * Validates the immutable active cache as a complete unit.  It intentionally
 * performs no network request and never mutates the active cache.
 */
export async function verifyActiveContent(
  cacheStorage: ContentCacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches,
  expectedContentVersion?: string,
): Promise<ActiveContentVerification> {
  if (!cacheStorage) return { status: 'pointer-invalid', message: 'Cache Storage is unavailable.' }
  const pointerResponse = await (await cacheStorage.open(CONTENT_META_CACHE)).match(ACTIVE_POINTER_URL)
  if (!pointerResponse) return { status: 'pointer-invalid', message: 'No active content pointer exists.' }
  let rawPointer: unknown
  try { rawPointer = await pointerResponse.json() } catch { return { status: 'pointer-invalid', message: 'The active content pointer is malformed.' } }
  const pointer = normalizeActiveContentPointer(rawPointer)
  if (!pointer || !(await cacheStorage.keys()).includes(pointer.cache_name)) {
    return { status: 'pointer-invalid', message: 'The active content pointer does not identify an existing content cache.' }
  }
  if (expectedContentVersion && pointer.content_version !== expectedContentVersion) {
    return { status: 'version-mismatch', pointer, message: 'The active cache version differs from the runtime content version.' }
  }
  const cache = await cacheStorage.open(pointer.cache_name)
  const manifestResponse = await cache.match(basePath('_generated/content-manifest.json'))
  if (!manifestResponse) return { status: 'missing', pointer, path: '_generated/content-manifest.json', message: 'The active cache is missing its manifest.' }
  const manifestBytes = await manifestResponse.arrayBuffer()
  if (await sha256(manifestBytes) !== pointer.manifest_fingerprint) {
    return { status: 'corrupt', pointer, path: '_generated/content-manifest.json', message: 'The active manifest fingerprint does not match the pointer.' }
  }
  let manifest: unknown
  try { manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) } catch { return { status: 'corrupt', pointer, path: '_generated/content-manifest.json', message: 'The active manifest is malformed.' } }
  if (!isDownloadManifest(manifest) || manifest.content_version !== pointer.content_version) {
    return { status: 'version-mismatch', pointer, message: 'The active manifest version does not match the pointer.' }
  }
  const expected = new Set([basePath('_generated/content-manifest.json'), ...manifest.files.map((file) => basePath(file.path))])
  for (const request of await cache.keys()) {
    if (!expected.has(cachePath(request))) return { status: 'corrupt', pointer, manifest, path: cachePath(request), message: 'The active cache contains an unexpected content file.' }
  }
  for (const file of manifest.files) {
    const response = await cache.match(basePath(file.path))
    if (!response) return { status: 'missing', pointer, manifest, path: file.path, message: 'The active cache is missing a content file.' }
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength !== file.bytes || await sha256(bytes) !== file.sha256) {
      return { status: 'corrupt', pointer, manifest, path: file.path, message: 'An active content file failed byte or hash verification.' }
    }
  }
  return { status: 'healthy', pointer, manifest, message: 'Active content is complete and verified.' }
}
