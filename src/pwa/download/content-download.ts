import { basePath, PROJECT_BASE_PATH } from '../../lib/base-path'
import { compareContentVersions, parseContentVersion } from '../../lib/content-version'
import { localState } from '../../app/state/local-state'
import type { OfflineFile, OfflineJob } from '../../app/state/reader-db'
import { canonicalContentPath, contentCacheName, contentCandidateCacheName, type ContentManifestFile, withNetworkBypass } from '../cache-protocol'
import { deleteCandidateCache, readActivePointer, type ContentCacheStorage } from '../content-cache'

const SAFETY_MARGIN_BYTES = 5 * 1024 * 1024

export interface DownloadManifest {
  schema_version: 1
  content_version: string
  base_path: '/myriad-atlas/'
  files: ContentManifestFile[]
}

export interface StorageEstimate { usage?: number; quota?: number }
export interface DownloadEstimate {
  payload_bytes_total: number
  required_storage_bytes: number
  usage?: number
  quota?: number
  available?: number
  persist_result?: boolean
  blocked: boolean
  confirmation_required: boolean
}

export class LowSpaceConfirmationRequiredError extends Error {
  constructor(readonly estimate: DownloadEstimate) {
    super('可用空间接近下载所需空间，需要确认。')
    this.name = 'LowSpaceConfirmationRequiredError'
  }
}

export class InsufficientStorageError extends Error {
  constructor(readonly estimate: DownloadEstimate) {
    super('可用空间不足，无法开始下载。')
    this.name = 'InsufficientStorageError'
  }
}

export interface DownloadDependencies {
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  cacheStorage?: ContentCacheStorage
  digest?: (bytes: ArrayBuffer) => Promise<string>
  storage?: { estimate?: () => Promise<StorageEstimate>; persist?: () => Promise<boolean> }
  now?: () => string
  nonce?: () => string
  failurePoint?: (point: 'before-fetch' | 'after-fetch' | 'before-cache-put', path: string) => void | Promise<void>
}

export interface ManifestPayload { manifest: DownloadManifest; bytes: ArrayBuffer; fingerprint: string }

function defaultCacheStorage(): ContentCacheStorage | undefined {
  return typeof caches === 'undefined' ? undefined : caches
}

function defaultStorage(): DownloadDependencies['storage'] {
  if (typeof navigator === 'undefined' || !navigator.storage) return undefined
  return { estimate: () => navigator.storage.estimate(), persist: () => navigator.storage.persist() }
}

export function isDownloadManifest(value: unknown): value is DownloadManifest {
  if (typeof value !== 'object' || value === null || !('schema_version' in value) || value.schema_version !== 1 || !('content_version' in value) || typeof value.content_version !== 'string' || !parseContentVersion(value.content_version)) return false
  if (!('base_path' in value) || value.base_path !== PROJECT_BASE_PATH || !('files' in value) || !Array.isArray(value.files)) return false
  const paths = new Set<string>()
  return value.files.every((file) => typeof file === 'object' && file !== null
    && 'path' in file && typeof file.path === 'string' && canonicalContentPath(basePath(file.path)) !== undefined && !file.path.includes('..')
    && 'kind' in file && typeof file.kind === 'string'
    && 'bytes' in file && typeof file.bytes === 'number' && Number.isSafeInteger(file.bytes) && file.bytes >= 0
    && 'sha256' in file && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)
    && !paths.has(file.path) && (paths.add(file.path), true))
}

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

class FileDownloadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'FileDownloadError'
  }
}

function errorCode(error: unknown): string {
  if (error instanceof FileDownloadError) return error.code
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'quota-exceeded'
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted'
  return error instanceof Error ? error.message : 'download-failed'
}

function fileDownloadError(file: ContentManifestFile, code: string, actualBytes: number | '未取得', options: { httpStatus?: number; actualSha256?: string } = {}): FileDownloadError {
  const details = [
    `文件 ${file.path} 下载失败`,
    options.httpStatus === undefined ? `错误代码：${code}` : `HTTP 状态：${options.httpStatus}`,
    `预期 bytes：${file.bytes}`,
    `实际 bytes：${actualBytes}`,
  ]
  if (options.actualSha256 !== undefined) details.push(`预期 SHA-256：${file.sha256}`, `实际 SHA-256：${options.actualSha256}`)
  return new FileDownloadError(code, details.join('；'))
}

function asFileDownloadError(file: ContentManifestFile, error: unknown): FileDownloadError {
  return error instanceof FileDownloadError ? error : fileDownloadError(file, errorCode(error), '未取得')
}

export class ContentDownloadManager {
  private readonly fetcher: NonNullable<DownloadDependencies['fetcher']>
  private readonly cacheStorage: ContentCacheStorage
  private readonly digest: NonNullable<DownloadDependencies['digest']>
  private readonly storage: DownloadDependencies['storage']
  private readonly now: NonNullable<DownloadDependencies['now']>
  private readonly nonce: NonNullable<DownloadDependencies['nonce']>
  private readonly failurePoint: NonNullable<DownloadDependencies['failurePoint']>
  private readonly controllers = new Map<string, AbortController>()

  constructor(options: DownloadDependencies = {}) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    const cacheStorage = options.cacheStorage ?? defaultCacheStorage()
    if (!cacheStorage) throw new Error('Cache Storage is unavailable.')
    this.cacheStorage = cacheStorage
    this.digest = options.digest ?? sha256
    this.storage = options.storage ?? defaultStorage()
    this.now = options.now ?? (() => new Date().toISOString())
    this.nonce = options.nonce ?? (() => crypto.randomUUID())
    this.failurePoint = options.failurePoint ?? (() => undefined)
  }

  async estimate(manifestBytes: number, files: ContentManifestFile[]): Promise<DownloadEstimate> {
    const payload_bytes_total = manifestBytes + files.reduce((total, file) => total + file.bytes, 0)
    const required_storage_bytes = payload_bytes_total + Math.max(SAFETY_MARGIN_BYTES, Math.ceil(payload_bytes_total * 0.1))
    const estimate = await this.storage?.estimate?.().catch(() => undefined)
    const persist_result = await this.storage?.persist?.().catch(() => false)
    const usage = estimate?.usage
    const quota = estimate?.quota
    const available = usage !== undefined && quota !== undefined ? Math.max(0, quota - usage) : undefined
    return {
      payload_bytes_total, required_storage_bytes, usage, quota, available, persist_result,
      blocked: available !== undefined && available < payload_bytes_total,
      confirmation_required: available !== undefined && available >= payload_bytes_total && available < required_storage_bytes,
    }
  }

  async start(options: { confirmLowSpace?: boolean; reuseActiveFiles?: boolean; forceCandidate?: boolean } = {}): Promise<OfflineJob> {
    const payload = await this.fetchManifest()
    const active = await readActivePointer(this.cacheStorage)
    const comparison = active ? compareContentVersions(active.content_version, payload.manifest.content_version, active.manifest_fingerprint, payload.fingerprint) : undefined
    if (comparison === 'fingerprint-mismatch') {
      throw new Error('内容版本指纹与当前活动版本冲突。')
    }
    if (comparison === 'newer') throw new Error('网络内容版本比当前活动版本更旧，已阻止降级。')
    const estimate = await this.estimate(payload.bytes.byteLength, payload.manifest.files)
    if (estimate.blocked) throw new InsufficientStorageError(estimate)
    if (estimate.confirmation_required && !options.confirmLowSpace) throw new LowSpaceConfirmationRequiredError(estimate)
    const candidateId = options.forceCandidate || active?.cache_name === contentCacheName(payload.manifest.content_version, payload.fingerprint) ? this.nonce() : undefined
    const cacheName = candidateId ? contentCandidateCacheName(payload.manifest.content_version, payload.fingerprint, candidateId) : contentCacheName(payload.manifest.content_version, payload.fingerprint)
    const job = this.newJob(payload, estimate, cacheName, candidateId)
    await localState.saveOfflineJob(job)
    await this.cacheManifest(job, payload)
    await this.ensureFiles(job, payload.manifest.files)
    await this.reconcileCompleteFiles(job, payload.manifest)
    if (options.reuseActiveFiles && active) await this.copyUnchangedActiveFiles(job, payload.manifest, active.cache_name)
    return this.run(job.job_id, payload.manifest)
  }

  /** Fetches and strictly validates only the network manifest; it never stages files. */
  async fetchNetworkManifest(): Promise<ManifestPayload> {
    return this.fetchManifest()
  }

  async pause(jobId: string): Promise<void> {
    this.controllers.get(jobId)?.abort()
    const job = await localState.getOfflineJob(jobId)
    if (!job || job.status === 'paused' || job.status === 'ready-to-activate' || job.status === 'active') return
    await localState.saveOfflineJob({ ...job, status: 'paused', current_path: null, error_code: 'interrupted', error_message: '下载已暂停。', updated_at: this.now() })
  }

  async resume(jobId: string): Promise<OfflineJob> {
    const job = await localState.getOfflineJob(jobId)
    if (!job) throw new Error('离线下载任务不存在。')
    const manifest = await this.readCachedManifest(job)
    await this.reconcileCompleteFiles(job, manifest)
    return this.run(jobId, manifest)
  }

  async retry(jobId: string): Promise<OfflineJob> {
    return this.resume(jobId)
  }

  async abandon(jobId: string): Promise<void> {
    const job = await localState.getOfflineJob(jobId)
    if (!job || (job.status !== 'failed' && job.status !== 'paused')) throw new Error('只能放弃未激活的失败或已暂停下载任务。')
    await localState.deleteOfflineJob(jobId)
    const deleted = await deleteCandidateCache(job.cache_name, [], this.cacheStorage)
    if (!deleted && (await this.cacheStorage.keys()).includes(job.cache_name)) throw new Error('候选知识缓存未能删除。')
  }

  async verifyJob(jobId: string): Promise<{ job: OfflineJob; manifest: DownloadManifest }> {
    const job = await localState.getOfflineJob(jobId)
    if (!job) throw new Error('离线下载任务不存在。')
    const manifest = await this.readCachedManifest(job)
    await this.verifyCandidate(job, manifest)
    return { job, manifest }
  }

  private async fetchManifest(): Promise<ManifestPayload> {
    const url = withNetworkBypass(basePath('_generated/content-manifest.json'), this.nonce())
    const response = await this.fetcher(url)
    if (!response.ok || response.type === 'opaque') throw new Error(`manifest-http-${response.status}`)
    const bytes = await response.arrayBuffer()
    let value: unknown
    try { value = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Error('manifest-malformed') }
    if (!isDownloadManifest(value)) throw new Error('manifest-invalid')
    return { manifest: value, bytes, fingerprint: await this.digest(bytes) }
  }

  private newJob(payload: ManifestPayload, estimate: DownloadEstimate, cacheName: string, candidateId?: string): OfflineJob {
    const timestamp = this.now()
    return {
      job_id: `offline-${payload.manifest.content_version}-${payload.fingerprint.slice(0, 12)}${candidateId ? `-${candidateId}` : ''}`,
      content_version: payload.manifest.content_version, manifest_fingerprint: payload.fingerprint,
      cache_name: cacheName, status: 'estimating',
      payload_bytes_total: estimate.payload_bytes_total, payload_bytes_done: 0, required_storage_bytes: estimate.required_storage_bytes,
      bytes_total: estimate.payload_bytes_total, bytes_done: 0, files_total: payload.manifest.files.length + 1, files_done: 0,
      current_path: null, error_code: null, error_message: null, created_at: timestamp, updated_at: timestamp,
    }
  }

  private async cacheManifest(job: OfflineJob, payload: ManifestPayload): Promise<void> {
    const cache = await this.cacheStorage.open(job.cache_name)
    await cache.put(basePath('_generated/content-manifest.json'), new Response(payload.bytes, { headers: { 'Content-Type': 'application/json' } }))
    await localState.saveOfflineJob({ ...job, payload_bytes_done: payload.bytes.byteLength, bytes_done: payload.bytes.byteLength, files_done: 1, updated_at: this.now() })
  }

  private async ensureFiles(job: OfflineJob, files: ContentManifestFile[]): Promise<void> {
    const existing = new Map((await localState.listOfflineFiles(job.job_id)).map((file) => [file.path, file]))
    const next = files.map<OfflineFile>((file) => existing.get(file.path) ?? {
      job_id: job.job_id, path: file.path, kind: file.kind, bytes: file.bytes, sha256: file.sha256,
      status: 'pending', attempts: 0, error_message: null, updated_at: this.now(),
    })
    await localState.saveOfflineFiles(next)
  }

  private async copyUnchangedActiveFiles(job: OfflineJob, manifest: DownloadManifest, activeCacheName: string): Promise<void> {
    const activeManifestResponse = await (await this.cacheStorage.open(activeCacheName)).match(basePath('_generated/content-manifest.json'))
    if (!activeManifestResponse) return
    let activeManifest: DownloadManifest
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(await activeManifestResponse.arrayBuffer()))
      if (!isDownloadManifest(value)) return
      activeManifest = value
    } catch {
      return
    }
    const activeFiles = new Map(activeManifest.files.map((file) => [file.path, file]))
    const activeCache = await this.cacheStorage.open(activeCacheName)
    const candidateCache = await this.cacheStorage.open(job.cache_name)
    for (const file of manifest.files) {
      const previous = activeFiles.get(file.path)
      if (!previous || previous.bytes !== file.bytes || previous.sha256 !== file.sha256) continue
      const response = await activeCache.match(basePath(file.path))
      if (!response) continue
      try {
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength !== file.bytes || await this.digest(bytes) !== file.sha256) continue
        await candidateCache.put(basePath(file.path), new Response(bytes, { headers: response.headers }))
        const record = (await localState.listOfflineFiles(job.job_id)).find((entry) => entry.path === file.path)
        if (record) await localState.saveOfflineFile({ ...record, status: 'complete', error_message: null, updated_at: this.now() })
      } catch {
        // A missing or unreadable active entry is deliberately fetched again in run().
      }
    }
    const files = await localState.listOfflineFiles(job.job_id)
    const bytesDone = (await this.cachedManifestBytes(job.cache_name)) + files.filter((entry) => entry.status === 'complete').reduce((total, entry) => total + entry.bytes, 0)
    await localState.saveOfflineJob({ ...job, payload_bytes_done: bytesDone, bytes_done: bytesDone, files_done: files.filter((entry) => entry.status === 'complete').length + 1, updated_at: this.now() })
  }

  private async run(jobId: string, manifest: DownloadManifest): Promise<OfflineJob> {
    const initial = await localState.getOfflineJob(jobId)
    if (!initial) throw new Error('离线下载任务不存在。')
    const controller = new AbortController()
    this.controllers.set(jobId, controller)
    let job: OfflineJob = { ...initial, status: 'downloading', error_code: null, error_message: null, updated_at: this.now() }
    await localState.saveOfflineJob(job)
    try {
      for (const file of manifest.files) {
        if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError')
        const record = (await localState.listOfflineFiles(jobId)).find((entry) => entry.path === file.path)
        if (record?.status === 'complete') continue
        job = await this.downloadFile(job, file, record, controller.signal)
      }
      job = { ...job, status: 'verifying', current_path: null, updated_at: this.now() }
      await localState.saveOfflineJob(job)
      await this.verifyCandidate(job, manifest)
      job = { ...job, status: 'ready-to-activate', payload_bytes_done: job.payload_bytes_total, bytes_done: job.payload_bytes_total, current_path: null, error_code: null, error_message: null, updated_at: this.now() }
      await localState.saveOfflineJob(job)
      return job
    } catch (error) {
      const paused = controller.signal.aborted || errorCode(error) === 'aborted'
      const latest = await localState.getOfflineJob(jobId) ?? job
      const next = paused
        ? { ...latest, status: 'paused' as const, current_path: null, error_code: 'interrupted', error_message: '下载已暂停。', updated_at: this.now() }
        : { ...latest, status: 'failed' as const, current_path: null, error_code: errorCode(error), error_message: error instanceof Error ? error.message : '下载失败。', updated_at: this.now() }
      await localState.saveOfflineJob(next)
      return next
    } finally {
      this.controllers.delete(jobId)
    }
  }

  private async downloadFile(job: OfflineJob, file: ContentManifestFile, previous: OfflineFile | undefined, signal: AbortSignal): Promise<OfflineJob> {
    const downloading: OfflineFile = { ...(previous ?? { job_id: job.job_id, path: file.path, kind: file.kind, bytes: file.bytes, sha256: file.sha256, attempts: 0 }), status: 'downloading', attempts: (previous?.attempts ?? 0) + 1, error_message: null, updated_at: this.now() }
    await localState.saveOfflineFile(downloading)
    const inFlight = { ...job, current_path: file.path, updated_at: this.now() }
    await localState.saveOfflineJob(inFlight)
    let response: Response
    try {
      await this.failurePoint('before-fetch', file.path)
      response = await this.fetcher(withNetworkBypass(basePath(file.path), this.nonce()), { signal })
      await this.failurePoint('after-fetch', file.path)
      if (!response.ok || response.type === 'opaque') {
        const actualBytes = response.type === 'opaque' ? '未取得' : await response.arrayBuffer().then((value) => value.byteLength).catch(() => '未取得' as const)
        throw fileDownloadError(file, response.type === 'opaque' ? 'opaque-response' : `http-${response.status}`, actualBytes, { httpStatus: response.type === 'opaque' ? undefined : response.status })
      }
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== file.bytes) throw fileDownloadError(file, 'bytes-mismatch', bytes.byteLength)
      const actualSha256 = await this.digest(bytes)
      if (actualSha256 !== file.sha256) throw fileDownloadError(file, 'hash-mismatch', bytes.byteLength, { actualSha256 })
      await this.failurePoint('before-cache-put', file.path)
      await (await this.cacheStorage.open(job.cache_name)).put(basePath(file.path), new Response(bytes, { status: response.status, headers: response.headers }))
      await localState.saveOfflineFile({ ...downloading, status: 'complete', error_message: null, updated_at: this.now() })
      const files = await localState.listOfflineFiles(job.job_id)
      const bytesDone = (await this.cachedManifestBytes(job.cache_name)) + files.filter((entry) => entry.status === 'complete').reduce((total, entry) => total + entry.bytes, 0)
      const next = { ...inFlight, payload_bytes_done: bytesDone, bytes_done: bytesDone, files_done: files.filter((entry) => entry.status === 'complete').length + 1, current_path: null, updated_at: this.now() }
      await localState.saveOfflineJob(next)
      return next
    } catch (error) {
      const status = signal.aborted ? 'pending' : 'failed'
      const failure = signal.aborted ? undefined : asFileDownloadError(file, error)
      await localState.saveOfflineFile({ ...downloading, status, error_message: signal.aborted ? '下载已暂停。' : failure!.message, updated_at: this.now() })
      throw failure ?? error
    }
  }

  private async readCachedManifest(job: OfflineJob): Promise<DownloadManifest> {
    const response = await (await this.cacheStorage.open(job.cache_name)).match(basePath('_generated/content-manifest.json'))
    if (!response) throw new Error('候选缓存缺少内容清单。')
    const bytes = await response.arrayBuffer()
    if (await this.digest(bytes) !== job.manifest_fingerprint) throw new Error('候选缓存内容清单指纹不一致。')
    let manifest: unknown
    try { manifest = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Error('候选缓存内容清单损坏。') }
    if (!isDownloadManifest(manifest) || manifest.content_version !== job.content_version) throw new Error('候选缓存内容清单无效。')
    return manifest
  }

  private async reconcileCompleteFiles(job: OfflineJob, manifest: DownloadManifest): Promise<void> {
    const cache = await this.cacheStorage.open(job.cache_name)
    const manifestPaths = new Set(manifest.files.map((file) => basePath(file.path)))
    for (const record of await localState.listOfflineFiles(job.job_id)) {
      if (record.status === 'complete' && !await cache.match(basePath(record.path))) await localState.saveOfflineFile({ ...record, status: 'pending', error_message: '缓存文件缺失，需要重新下载。', updated_at: this.now() })
      if (!manifestPaths.has(basePath(record.path))) await localState.saveOfflineFile({ ...record, status: 'failed', error_message: '文件不在当前内容清单中。', updated_at: this.now() })
    }
  }

  private async verifyCandidate(job: OfflineJob, manifest: DownloadManifest): Promise<void> {
    const cache = await this.cacheStorage.open(job.cache_name)
    const expected = new Set([basePath('_generated/content-manifest.json'), ...manifest.files.map((file) => basePath(file.path))])
    for (const request of await cache.keys()) if (!expected.has(new URL(request.url).pathname)) throw new Error('candidate-cache-extra-file')
    for (const file of manifest.files) {
      const response = await cache.match(basePath(file.path))
      if (!response) throw new Error('candidate-cache-missing-file')
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== file.bytes || await this.digest(bytes) !== file.sha256) throw new Error('candidate-cache-verification-failed')
    }
  }

  private async cachedManifestBytes(cacheName: string): Promise<number> {
    const response = await (await this.cacheStorage.open(cacheName)).match(basePath('_generated/content-manifest.json'))
    return response ? (await response.clone().arrayBuffer()).byteLength : 0
  }
}
