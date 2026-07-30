export const PROJECT_BASE_PATH = '/myriad-atlas/'
export const CONTENT_CACHE_PREFIX = 'myriad-atlas-content-v1-'
export const CONTENT_META_CACHE = 'myriad-atlas-content-meta-v1'
export const ACTIVE_POINTER_URL = `${PROJECT_BASE_PATH}__offline/active.json`
export const NETWORK_BYPASS_PARAMETER = '__myriad_network'
export const ACTIVE_CONTENT_POINTER_SCHEMA_VERSION = 1

export interface ContentManifestFile {
  path: string
  kind: string
  bytes: number
  sha256: string
}

export interface ActiveContentPointer {
  schema_version: typeof ACTIVE_CONTENT_POINTER_SCHEMA_VERSION
  content_version: string
  manifest_fingerprint: string
  cache_name: string
  activated_at: string
  /** Kept with the pointer so a failed smoke load can restore the last known-good version. */
  previous_cache_name?: string | null
}

export const CONTENT_CACHE_MESSAGES = {
  activated: 'CONTENT_ACTIVATED',
  rolledBack: 'CONTENT_ROLLED_BACK',
} as const

function safeSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value)
}

export function contentCacheName(contentVersion: string, manifestFingerprint: string): string {
  if (!safeSegment(contentVersion) || !/^[a-f0-9]{64}$/.test(manifestFingerprint)) throw new Error('Invalid content cache identity.')
  return `${CONTENT_CACHE_PREFIX}${contentVersion}-${manifestFingerprint}`
}

/**
 * A repair of an already active manifest needs a second cache identity.  Keeping
 * the immutable version/fingerprint prefix makes it auditable while preventing
 * an in-place write to the active cache.
 */
export function contentCandidateCacheName(contentVersion: string, manifestFingerprint: string, candidateId: string): string {
  if (!safeSegment(candidateId)) throw new Error('Invalid content cache candidate identity.')
  return `${contentCacheName(contentVersion, manifestFingerprint)}-candidate-${candidateId}`
}

export function isContentCacheName(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^${CONTENT_CACHE_PREFIX}[A-Za-z0-9._-]+-[a-f0-9]{64}(?:-candidate-[A-Za-z0-9._-]+)?$`).test(value)
}

/**
 * Reads both the original unversioned pointer and the current v1 form. Cache
 * Storage is authoritative, so legacy pointers are normalized before use.
 */
export function normalizeActiveContentPointer(value: unknown): ActiveContentPointer | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('content_version' in value) || typeof value.content_version !== 'string' || !safeSegment(value.content_version)) return undefined
  if (!('manifest_fingerprint' in value) || typeof value.manifest_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.manifest_fingerprint)) return undefined
  if (!('cache_name' in value) || typeof value.cache_name !== 'string' || !isContentCacheName(value.cache_name)) return undefined
  if (value.cache_name !== contentCacheName(value.content_version, value.manifest_fingerprint)
    && !value.cache_name.startsWith(`${contentCacheName(value.content_version, value.manifest_fingerprint)}-candidate-`)) return undefined
  if (!('activated_at' in value) || typeof value.activated_at !== 'string' || Number.isNaN(Date.parse(value.activated_at))) return undefined
  const previousCacheName = 'previous_cache_name' in value ? value.previous_cache_name : undefined
  if (previousCacheName !== undefined && previousCacheName !== null
    && (typeof previousCacheName !== 'string' || !isContentCacheName(previousCacheName))) return undefined

  const schemaVersion = 'schema_version' in value ? value.schema_version : undefined
  if (schemaVersion !== undefined && schemaVersion !== ACTIVE_CONTENT_POINTER_SCHEMA_VERSION) return undefined
  return {
    schema_version: ACTIVE_CONTENT_POINTER_SCHEMA_VERSION,
    content_version: value.content_version,
    manifest_fingerprint: value.manifest_fingerprint,
    cache_name: value.cache_name,
    activated_at: value.activated_at,
    previous_cache_name: previousCacheName,
  }
}

export function isActiveContentPointer(value: unknown): value is ActiveContentPointer {
  return normalizeActiveContentPointer(value) !== undefined
}

export function canonicalContentPath(input: string | URL, expectedOrigin?: string): string | undefined {
  const url = input instanceof URL ? input : new URL(input, expectedOrigin ?? 'https://myriad-atlas.invalid')
  if (expectedOrigin && url.origin !== expectedOrigin) return undefined
  const generatedPrefix = `${PROJECT_BASE_PATH}_generated/`
  const mediaPrefix = `${PROJECT_BASE_PATH}media/`
  if (!url.pathname.startsWith(generatedPrefix) && !url.pathname.startsWith(mediaPrefix)) return undefined
  return url.pathname
}

export function hasNetworkBypass(input: string | URL): boolean {
  const url = input instanceof URL ? input : new URL(input, 'https://myriad-atlas.invalid')
  return url.searchParams.has(NETWORK_BYPASS_PARAMETER)
}

export function withNetworkBypass(input: string | URL, nonce: string, expectedOrigin?: string): string {
  const relativeInput = typeof input === 'string' && input.startsWith('/')
  if (!relativeInput && !expectedOrigin) throw new Error('An expected origin is required for absolute content URLs.')
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input, expectedOrigin ?? 'https://myriad-atlas.invalid')
  const canonical = canonicalContentPath(url, expectedOrigin)
  if (!canonical || !safeSegment(nonce)) throw new Error('Only project content paths may bypass the active cache.')
  url.pathname = canonical
  url.search = ''
  url.hash = ''
  url.searchParams.set(NETWORK_BYPASS_PARAMETER, nonce)
  return url.toString().replace(url.origin, '')
}
