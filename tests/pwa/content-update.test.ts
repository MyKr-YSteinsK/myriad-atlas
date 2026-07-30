import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readerDb } from '../../src/app/state/reader-db'
import { localState } from '../../src/app/state/local-state'
import { basePath } from '../../src/lib/base-path'
import { contentCacheName } from '../../src/pwa/cache-protocol'
import { readActivePointer } from '../../src/pwa/content-cache'
import { ContentDownloadManager, type DownloadManifest } from '../../src/pwa/download/content-download'
import { ContentActivationManager } from '../../src/pwa/update/content-activation'
import { cleanupTemporaryContentCaches } from '../../src/pwa/update/cache-cleanup'
import { verifyActiveContent } from '../../src/pwa/update/content-integrity'
import { KnowledgeUpdateChecker } from '../../src/pwa/update/knowledge-update-check'
import { ContentRepairManager } from '../../src/pwa/update/content-repair'

const origin = 'https://example.test'

class MemoryCacheStorage {
  readonly entries = new Map<string, Map<string, Response>>()
  failPointerPut = false
  async keys(): Promise<string[]> { return [...this.entries.keys()] }
  async delete(name: string): Promise<boolean> { return this.entries.delete(name) }
  async open(name: string): Promise<Cache> {
    const values = this.entries.get(name) ?? new Map<string, Response>()
    this.entries.set(name, values)
    const key = (request: RequestInfo | URL): string => {
      const value = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
      return new URL(value, origin).pathname
    }
    return {
      match: async (request: RequestInfo | URL) => values.get(key(request))?.clone(),
      put: async (request: RequestInfo | URL, response: Response) => {
        if (this.failPointerPut && name === 'myriad-atlas-content-meta-v1') throw new Error('pointer-write-failed')
        values.set(key(request), response.clone())
      },
      keys: async () => [...values.keys()].map((path) => new Request(`${origin}${path}`)),
    } as unknown as Cache
  }
}

async function hash(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', value)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function makeFixture(version: string, entries: Record<string, string>): Promise<{ manifest: DownloadManifest; text: string; responses: Map<string, Response> }> {
  const files = await Promise.all(Object.entries(entries).map(async ([path, text]) => {
    const bytes = new TextEncoder().encode(text)
    return { path, kind: path.includes('catalog') ? 'catalog' : 'runtime', bytes: bytes.byteLength, sha256: await hash(bytes.buffer as ArrayBuffer) }
  }))
  const manifest: DownloadManifest = { schema_version: 1, content_version: version, base_path: '/myriad-atlas/', files }
  return {
    manifest,
    text: JSON.stringify(manifest),
    responses: new Map(Object.entries(entries).map(([path, text]) => [basePath(path), new Response(text)])),
  }
}

function createDownload(storage: MemoryCacheStorage, data: { text: string; responses: Map<string, Response> }, fetchSpy = vi.fn()): ContentDownloadManager {
  return new ContentDownloadManager({
    cacheStorage: storage,
    fetcher: async (input) => {
      fetchSpy(input)
      const url = new URL(typeof input === 'string' ? input : input.toString(), origin)
      if (url.pathname === basePath('_generated/content-manifest.json')) return new Response(data.text)
      return data.responses.get(url.pathname)?.clone() ?? new Response('missing', { status: 404 })
    },
    storage: { estimate: async () => ({ usage: 0, quota: 100_000_000 }), persist: async () => true },
    nonce: () => 'test-candidate',
  })
}

function activation(storage: MemoryCacheStorage, download: ContentDownloadManager, options: { smoke?: () => Promise<void>; notify?: () => Promise<void> } = {}) {
  const repository = { invalidate: vi.fn() }
  const search = { reset: vi.fn() }
  return {
    manager: new ContentActivationManager({
      cacheStorage: storage,
      download,
      repository: repository as never,
      search: search as never,
      smokeLoad: options.smoke ?? (async () => undefined),
      notifyWorker: async () => options.notify?.(),
    }), repository, search,
  }
}

describe('knowledge activation, update and repair', () => {
  beforeEach(async () => {
    await readerDb.delete()
    await readerDb.open()
  })

  it('activates only a reverified candidate and resets in-memory content consumers', async () => {
    const storage = new MemoryCacheStorage()
    const data = await makeFixture('2026.07.30-01', { '_generated/catalog.json': 'catalog', '_generated/removed.json': 'old' })
    const download = createDownload(storage, data)
    const job = await download.start()
    const { manager, repository, search } = activation(storage, download)

    await expect(manager.activate(job.job_id)).resolves.toMatchObject({ active: true, rolledBack: false })
    expect(await readActivePointer(storage)).toMatchObject({ cache_name: job.cache_name, previous_cache_name: null })
    expect((await localState.getOfflineJob(job.job_id))?.status).toBe('active')
    expect(repository.invalidate).toHaveBeenCalled()
    expect(search.reset).toHaveBeenCalled()
  })

  it('keeps the old pointer when pointer write, worker notification, or smoke loading fails', async () => {
    const data = await makeFixture('2026.07.30-01', { '_generated/catalog.json': 'catalog' })
    const pointerStorage = new MemoryCacheStorage()
    const pointerDownload = createDownload(pointerStorage, data)
    const pointerJob = await pointerDownload.start()
    pointerStorage.failPointerPut = true
    await expect(activation(pointerStorage, pointerDownload).manager.activate(pointerJob.job_id)).resolves.toMatchObject({ active: false, rolledBack: false })
    expect(await readActivePointer(pointerStorage)).toBeUndefined()

    const storage = new MemoryCacheStorage()
    const first = createDownload(storage, data)
    const active = await first.start()
    await activation(storage, first).manager.activate(active.job_id)
    const newer = await makeFixture('2026.07.31-01', { '_generated/catalog.json': 'new catalog' })
    const nextDownload = createDownload(storage, newer)
    const candidate = await nextDownload.start()
    await expect(activation(storage, nextDownload, { notify: async () => { throw new Error('worker-failed') } }).manager.activate(candidate.job_id)).resolves.toMatchObject({ active: false, rolledBack: true })
    expect((await readActivePointer(storage))?.cache_name).toBe(active.cache_name)

    const smokeCandidate = await createDownload(storage, newer).start()
    await expect(activation(storage, createDownload(storage, newer), { smoke: async () => { throw new Error('smoke-failed') } }).manager.activate(smokeCandidate.job_id)).resolves.toMatchObject({ active: false, rolledBack: true })
    expect((await readActivePointer(storage))?.cache_name).toBe(active.cache_name)
  })

  it('copies unchanged files, downloads changes, and excludes removed files from an update candidate', async () => {
    const storage = new MemoryCacheStorage()
    const v1 = await makeFixture('2026.07.30-01', {
      '_generated/catalog.json': 'same', '_generated/changed.json': 'old', '_generated/removed.json': 'gone',
    })
    const first = createDownload(storage, v1)
    const active = await first.start()
    await activation(storage, first).manager.activate(active.job_id)
    const v2 = await makeFixture('2026.07.31-01', {
      '_generated/catalog.json': 'same', '_generated/changed.json': 'new', '_generated/new.json': 'added',
    })
    const spy = vi.fn()
    const update = createDownload(storage, v2, spy)
    const candidate = await update.start({ reuseActiveFiles: true })
    const paths = spy.mock.calls.map(([input]) => new URL(typeof input === 'string' ? input : input.toString(), origin).pathname)
    expect(paths.filter((path) => path === basePath('_generated/catalog.json'))).toHaveLength(0)
    expect(paths).toEqual(expect.arrayContaining([basePath('_generated/changed.json'), basePath('_generated/new.json')]))
    const cache = await storage.open(candidate.cache_name)
    expect(await cache.match(basePath('_generated/removed.json'))).toBeUndefined()
    expect(candidate.status).toBe('ready-to-activate')
  })

  it('reports update states without automatically downloading, including conflicts and downgrade protection', async () => {
    const storage = new MemoryCacheStorage()
    const v1 = await makeFixture('2026.07.30-01', { '_generated/catalog.json': 'catalog' })
    const first = createDownload(storage, v1)
    const active = await first.start()
    await activation(storage, first).manager.activate(active.job_id)
    const v2 = await makeFixture('2026.07.31-01', { '_generated/catalog.json': 'new' })
    await expect(new KnowledgeUpdateChecker({ download: createDownload(storage, v2), cacheStorage: storage }).check({ manual: true })).resolves.toMatchObject({ status: 'update-available' })
    const v2Download = createDownload(storage, v2)
    const v2Job = await v2Download.start()
    await activation(storage, v2Download).manager.activate(v2Job.job_id)
    await expect(createDownload(storage, v1).start()).rejects.toThrow('降级')

    const conflicting = await makeFixture('2026.07.31-01', { '_generated/catalog.json': 'different' })
    await expect(new KnowledgeUpdateChecker({ download: createDownload(storage, conflicting), cacheStorage: storage }).check({ manual: true })).resolves.toMatchObject({ status: 'fingerprint-conflict' })
    await expect(createDownload(storage, conflicting).start()).rejects.toThrow('指纹')
  })

  it('detects missing and corrupt active files, stages repair separately, and cleans only unreferenced content caches', async () => {
    const storage = new MemoryCacheStorage()
    const data = await makeFixture('2026.07.30-01', { '_generated/catalog.json': 'catalog' })
    const download = createDownload(storage, data)
    const active = await download.start()
    await activation(storage, download).manager.activate(active.job_id)
    const cache = await storage.open(active.cache_name)
    await cache.put(basePath('_generated/catalog.json'), new Response('tampered'))
    await expect(verifyActiveContent(storage)).resolves.toMatchObject({ status: 'corrupt', path: '_generated/catalog.json' })
    const repair = await new ContentRepairManager(createDownload(storage, data), storage).stageRepair()
    expect(repair.job).toMatchObject({ status: 'ready-to-activate' })
    expect(repair.job?.cache_name).not.toBe(active.cache_name)
    expect(await cache.match(basePath('_generated/catalog.json'))).toBeTruthy()

    const orphan = contentCacheName('2026.07.29-01', 'a'.repeat(64))
    await storage.open(orphan)
    await storage.open('workbox-precache-v3')
    expect(await cleanupTemporaryContentCaches(storage)).toEqual(expect.arrayContaining([orphan, repair.job!.cache_name]))
    expect(await storage.keys()).toEqual(expect.arrayContaining([active.cache_name, 'workbox-precache-v3']))
  })
})
