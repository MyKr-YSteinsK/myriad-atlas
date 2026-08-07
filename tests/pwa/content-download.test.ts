import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readerDb } from '../../src/app/state/reader-db'
import { localState } from '../../src/app/state/local-state'
import { basePath } from '../../src/lib/base-path'
import { contentCacheName } from '../../src/pwa/cache-protocol'
import { ContentDownloadManager, InsufficientStorageError, LowSpaceConfirmationRequiredError, type DownloadManifest } from '../../src/pwa/download/content-download'
import { readActivePointer, writeActivePointer } from '../../src/pwa/content-cache'

const origin = 'https://example.test'

class MemoryCacheStorage {
  private readonly caches = new Map<string, Map<string, Response>>()
  async keys(): Promise<string[]> { return [...this.caches.keys()] }
  async delete(name: string): Promise<boolean> { return this.caches.delete(name) }
  async open(name: string): Promise<Cache> {
    const values = this.caches.get(name) ?? new Map<string, Response>()
    this.caches.set(name, values)
    const key = (request: RequestInfo | URL): string => {
      const value = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
      return new URL(value, origin).pathname
    }
    return {
      match: async (request: RequestInfo | URL) => values.get(key(request))?.clone(),
      put: async (request: RequestInfo | URL, response: Response) => { values.set(key(request), response.clone()) },
      keys: async () => [...values.keys()].map((path) => new Request(`${origin}${path}`)),
    } as unknown as Cache
  }
}

async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
async function fixture(): Promise<{ manifest: DownloadManifest; manifestText: string; responses: Map<string, Response> }> {
  const catalog = new TextEncoder().encode('{"catalog":true}')
  const log = new TextEncoder().encode('{"log":true}')
  const manifest: DownloadManifest = {
    schema_version: 1, content_version: '2026.07.30-01', base_path: '/myriad-atlas/', files: [
      { path: '_generated/catalog.json', kind: 'catalog', bytes: catalog.byteLength, sha256: await hashBytes(catalog.buffer) },
      { path: '_generated/app-changelog.json', kind: 'app-changelog', bytes: log.byteLength, sha256: await hashBytes(log.buffer) },
    ],
  }
  const manifestText = JSON.stringify(manifest)
  return {
    manifest, manifestText,
    responses: new Map([
      [basePath('_generated/catalog.json'), new Response(catalog, { headers: { 'Content-Type': 'application/json' } })],
      [basePath('_generated/app-changelog.json'), new Response(log, { headers: { 'Content-Type': 'application/json' } })],
    ]),
  }
}

function manager(storage: MemoryCacheStorage, manifestText: string, responses: Map<string, Response>, options: Partial<ConstructorParameters<typeof ContentDownloadManager>[0]> = {}): ContentDownloadManager {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const url = new URL(typeof input === 'string' ? input : input.toString(), origin)
    if (url.pathname === basePath('_generated/content-manifest.json')) return new Response(manifestText, { headers: { 'Content-Type': 'application/json' } })
    const response = responses.get(url.pathname)
    if (!response) return new Response('missing', { status: 404 })
    return response.clone()
  })
  return new ContentDownloadManager({
    fetcher,
    cacheStorage: storage,
    storage: { estimate: async () => ({ usage: 10, quota: 100_000_000 }), persist: async () => true },
    nonce: () => 'test-nonce',
    ...options,
  })
}

describe('complete knowledge download', () => {
  beforeEach(async () => {
    await readerDb.delete()
    await readerDb.open()
  })

  it('downloads, validates, and stages every manifest file without changing the active pointer', async () => {
    const storage = new MemoryCacheStorage()
    const data = await fixture()
    const download = manager(storage, data.manifestText, data.responses)
    const job = await download.start()

    expect(job.status).toBe('ready-to-activate')
    expect(job.files_done).toBe(3)
    expect(job.payload_bytes_done).toBe(job.payload_bytes_total)
    expect(job.required_storage_bytes).toBeGreaterThan(job.payload_bytes_total)
    const files = await localState.listOfflineFiles(job.job_id)
    expect(files.every((file) => file.status === 'complete')).toBe(true)
    const cache = await storage.open(job.cache_name)
    expect(await cache.match(basePath('_generated/content-manifest.json'))).toBeTruthy()
    expect(await cache.match(basePath('_generated/catalog.json'))).toBeTruthy()
    expect(await localState.getAppMeta('offline.active')).toBeUndefined()
  })

  it('records bytes/hash, HTTP, and quota failures without activating content', async () => {
    const storage = new MemoryCacheStorage()
    const data = await fixture()
    const wrongBytes = new Map(data.responses)
    wrongBytes.set(basePath('_generated/catalog.json'), new Response('short'))
    const failed = await manager(storage, data.manifestText, wrongBytes).start()
    expect(failed).toMatchObject({ status: 'failed', error_code: 'bytes-mismatch' })
    expect(failed.error_message).toContain('文件 _generated/catalog.json 下载失败；错误代码：bytes-mismatch；预期 bytes：16；实际 bytes：5')
    expect((await localState.listOfflineFiles(failed.job_id)).find((file) => file.path === '_generated/catalog.json')).toMatchObject({ status: 'failed', attempts: 1 })

    const before = (await localState.listOfflineJobs()).length
    await expect(manager(new MemoryCacheStorage(), data.manifestText, data.responses, { storage: { estimate: async () => ({ usage: 99, quota: 100 }) } }).start()).rejects.toBeInstanceOf(InsufficientStorageError)
    expect(await localState.listOfflineJobs()).toHaveLength(before)
    expect(await localState.getAppMeta('offline.active')).toBeUndefined()
  })

  it('requires confirmation without creating a job, then stages payload progress separately from storage headroom', async () => {
    const storage = new MemoryCacheStorage()
    const data = await fixture()
    const payloadBytes = new TextEncoder().encode(data.manifestText).byteLength + data.manifest.files.reduce((total, file) => total + file.bytes, 0)
    const download = manager(storage, data.manifestText, data.responses, { storage: { estimate: async () => ({ usage: 0, quota: payloadBytes + 1 }) } })

    await expect(download.start()).rejects.toBeInstanceOf(LowSpaceConfirmationRequiredError)
    expect(await localState.listOfflineJobs()).toEqual([])
    const job = await download.start({ confirmLowSpace: true })
    expect(job).toMatchObject({ status: 'ready-to-activate', payload_bytes_done: payloadBytes, payload_bytes_total: payloadBytes })
    expect(job.required_storage_bytes).toBeGreaterThan(payloadBytes)
  })

  it('does not let hard storage insufficiency bypass confirmation', async () => {
    const storage = new MemoryCacheStorage()
    const data = await fixture()
    const payloadBytes = new TextEncoder().encode(data.manifestText).byteLength + data.manifest.files.reduce((total, file) => total + file.bytes, 0)
    const download = manager(storage, data.manifestText, data.responses, { storage: { estimate: async () => ({ usage: 0, quota: payloadBytes - 1 }) } })
    await expect(download.start({ confirmLowSpace: true })).rejects.toBeInstanceOf(InsufficientStorageError)
    expect(await localState.listOfflineJobs()).toEqual([])
  })

  it('keeps failed jobs recoverable for hash, HTTP, and Cache Storage quota errors', async () => {
    const data = await fixture()
    const hashManifest = { ...data.manifest, files: [{ ...data.manifest.files[0], sha256: 'c'.repeat(64) }, data.manifest.files[1]] }
    const hashFailure = await manager(new MemoryCacheStorage(), JSON.stringify(hashManifest), data.responses).start()
    expect(hashFailure).toMatchObject({ status: 'failed', error_code: 'hash-mismatch' })
    expect(hashFailure.error_message).toContain('预期 SHA-256：cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')
    expect(hashFailure.error_message).toContain('实际 SHA-256：')

    const missing = new Map(data.responses)
    missing.delete(basePath('_generated/catalog.json'))
    const httpFailure = await manager(new MemoryCacheStorage(), data.manifestText, missing).start()
    expect(httpFailure).toMatchObject({ status: 'failed', error_code: 'http-404' })
    expect(httpFailure.error_message).toContain('文件 _generated/catalog.json 下载失败；HTTP 状态：404；预期 bytes：16；实际 bytes：7')

    const quotaFailure = await manager(new MemoryCacheStorage(), data.manifestText, data.responses, {
      failurePoint: (point) => { if (point === 'before-cache-put') throw new DOMException('quota', 'QuotaExceededError') },
    }).start()
    expect(quotaFailure).toMatchObject({ status: 'failed', error_code: 'quota-exceeded' })
  })

  it('abandons a failed candidate without changing the active cache or personal state', async () => {
    const storage = new MemoryCacheStorage()
    const activeFingerprint = 'a'.repeat(64)
    const active = { schema_version: 1 as const, content_version: '2026.07.29-01', manifest_fingerprint: activeFingerprint, cache_name: contentCacheName('2026.07.29-01', activeFingerprint), activated_at: '2026-07-29T00:00:00.000Z' }
    await storage.open(active.cache_name)
    await writeActivePointer(active, storage)
    await localState.toggleCompleted('node-a')
    const data = await fixture()
    const missing = new Map(data.responses)
    missing.delete(basePath('_generated/catalog.json'))
    const download = manager(storage, data.manifestText, missing)
    const failed = await download.start()

    await download.abandon(failed.job_id)

    expect(await localState.getOfflineJob(failed.job_id)).toBeUndefined()
    expect(await localState.listOfflineFiles(failed.job_id)).toEqual([])
    expect(await storage.keys()).toEqual(expect.arrayContaining([active.cache_name]))
    expect(await storage.keys()).not.toContain(failed.cache_name)
    expect(await readActivePointer(storage)).toMatchObject(active)
    expect(await localState.getNode('node-a')).toMatchObject({ completed: true })
  })

  it('pauses an in-flight request and resumes by skipping complete cache entries', async () => {
    const storage = new MemoryCacheStorage()
    const data = await fixture()
    let release: (() => void) | undefined
    const blocker = new Promise<void>((resolve) => { release = resolve })
    const download = manager(storage, data.manifestText, data.responses, {
      failurePoint: async (point, path) => { if (point === 'before-fetch' && path === '_generated/app-changelog.json') await blocker },
    })
    const pending = download.start()
    await vi.waitFor(async () => expect((await localState.listOfflineJobs())[0]?.current_path).toBe('_generated/app-changelog.json'))
    const jobId = (await localState.listOfflineJobs())[0].job_id
    await download.pause(jobId)
    release?.()
    const paused = await pending
    expect(paused.status).toBe('paused')
    const completeBefore = await storage.open(paused.cache_name).then((cache) => cache.match(basePath('_generated/catalog.json')))
    expect(completeBefore).toBeTruthy()
    const ready = await download.resume(jobId)
    expect(ready.status).toBe('ready-to-activate')
  })

  it('redownloads complete records with missing cache entries and rejects candidate extras', async () => {
    const storage = new MemoryCacheStorage()
    const data = await fixture()
    const download = manager(storage, data.manifestText, data.responses)
    const complete = await download.start()
    await storage.delete(complete.cache_name)
    await storage.open(complete.cache_name).then((cache) => cache.put(basePath('_generated/content-manifest.json'), new Response(data.manifestText)))
    const resumed = await download.resume(complete.job_id)
    expect(resumed.status).toBe('ready-to-activate')

    const extraStorage = new MemoryCacheStorage()
    const extraDownload = manager(extraStorage, data.manifestText, data.responses)
    const original = await extraDownload.start()
    await extraStorage.open(original.cache_name).then((cache) => cache.put('/myriad-atlas/_generated/unlisted.json', new Response('extra')))
    const retry = await extraDownload.retry(original.job_id)
    expect(retry).toMatchObject({ status: 'failed', error_code: 'candidate-cache-extra-file' })
  })

  it('does not replace an active same-version pointer with a different fingerprint', async () => {
    const storage = new MemoryCacheStorage()
    const data = await fixture()
    const activeFingerprint = 'b'.repeat(64)
    const active = { schema_version: 1 as const, content_version: data.manifest.content_version, manifest_fingerprint: activeFingerprint, cache_name: contentCacheName(data.manifest.content_version, activeFingerprint), activated_at: '2026-07-30T00:00:00.000Z' }
    await storage.open(active.cache_name)
    await writeActivePointer(active, storage)
    await expect(manager(storage, data.manifestText, data.responses).start()).rejects.toThrow('缺少内容清单')
    expect(await localState.getAppMeta('offline.active')).toBeUndefined()
  })
})
