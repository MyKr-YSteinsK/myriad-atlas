import { describe, expect, it, vi } from 'vitest'
import { ContentRepository } from '../../src/lib/content-client'
import { ContentClientError } from '../../src/lib/errors'
import { SearchRepository, toSearchExcerpt } from '../../src/lib/search-repository'

const version = '2026.07.30-01'
const emptyCatalog = { schema_version: 1, content_version: version, nodes: [] }
const emptyTaxonomy = { schema_version: 1, content_version: version, domains: [] }
const emptyRoutes = { schema_version: 1, content_version: version, routes: [] }
const emptyQa = { schema_version: 1, content_version: version, chains: [] }
const emptyManifest = { schema_version: 1, content_version: version, base_path: '/myriad-atlas/', files: [] }
const appLog = { schema_version: 1, current_version: '0.2.0', entries: [{ version: '0.2.0', date: '2026-07-30', summary: 'current' }] }
const knowledgeLog = { schema_version: 1, current_version: version, entries: [{ version, date: '2026-07-30', summary: 'initial', categories: [], added_nodes: [], modified_nodes: [], deleted_nodes: [] }] }

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status })
}

describe('runtime content repositories', () => {
  it('loads every resource through the fixed project base path and caches completed reads', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(emptyCatalog))
      .mockResolvedValueOnce(json(emptyTaxonomy))
      .mockResolvedValueOnce(json(emptyRoutes))
      .mockResolvedValueOnce(json(emptyQa))
    const repository = new ContentRepository(fetcher)
    await repository.loadCatalog()
    await repository.loadCatalog()
    await repository.loadTaxonomy()
    await repository.loadRoutesIndex()
    await repository.loadQaIndex()

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/myriad-atlas/_generated/catalog.json',
      '/myriad-atlas/_generated/taxonomy.json',
      '/myriad-atlas/_generated/routes.json',
      '/myriad-atlas/_generated/qa-index.json',
    ])
  })

  it('rejects version conflicts, unsupported schemas and malformed resources', async () => {
    const conflict = new ContentRepository(vi.fn()
      .mockResolvedValueOnce(json(emptyCatalog))
      .mockResolvedValueOnce(json({ ...emptyTaxonomy, content_version: 'other' })))
    await conflict.loadCatalog()
    await expect(conflict.loadTaxonomy()).rejects.toMatchObject({ kind: 'application' } satisfies Partial<ContentClientError>)

    await expect(new ContentRepository(vi.fn().mockResolvedValue(json({ ...emptyCatalog, schema_version: 2 }))).loadCatalog())
      .rejects.toMatchObject({ kind: 'unsupported-version' } satisfies Partial<ContentClientError>)
    await expect(new ContentRepository(vi.fn().mockResolvedValue(json({ schema_version: 1, content_version: version }))).loadCatalog())
      .rejects.toMatchObject({ kind: 'malformed' } satisfies Partial<ContentClientError>)
  })

  it('separates 404, malformed JSON and abort while refusing path injection', async () => {
    await expect(new ContentRepository(vi.fn().mockResolvedValue(new Response('', { status: 404 }))).loadCatalog())
      .rejects.toMatchObject({ kind: 'missing' } satisfies Partial<ContentClientError>)
    await expect(new ContentRepository(vi.fn().mockResolvedValue(new Response('{', { status: 200 }))).loadCatalog())
      .rejects.toMatchObject({ kind: 'malformed' } satisfies Partial<ContentClientError>)
    const aborted = new DOMException('aborted', 'AbortError')
    await expect(new ContentRepository(vi.fn().mockRejectedValue(aborted)).loadCatalog()).rejects.toBe(aborted)
    await expect(new ContentRepository(vi.fn()).loadNode('../secret')).rejects.toMatchObject({ kind: 'missing' })
    await expect(new ContentRepository(vi.fn()).loadRoute('../secret')).rejects.toMatchObject({ kind: 'missing' })
  })

  it('reports active offline cache damage without falling back to a mixed network version', async () => {
    const offline = new ContentRepository(vi.fn().mockResolvedValue(new Response('missing active file', { status: 503, headers: { 'X-Myriad-Offline': 'active-cache-miss' } })))
    await expect(offline.loadCatalog()).rejects.toMatchObject({
      kind: 'offline', message: '离线内容已损坏，请检查完整性或重新下载。',
    } satisfies Partial<ContentClientError>)
  })

  it('passes AbortSignal to fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(emptyCatalog))
    const signal = new AbortController().signal
    await new ContentRepository(fetcher).loadCatalog(signal)
    expect(fetcher).toHaveBeenCalledWith('/myriad-atlas/_generated/catalog.json', { signal })
  })
  it('invalidates completed and in-flight reads before loading a new content version', async () => {
    let resolveOld: ((response: Response) => void) | undefined
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce(json({ ...emptyCatalog, content_version: '2026.07.31-01' }))
    const repository = new ContentRepository(fetcher)
    const stale = repository.loadCatalog()
    repository.invalidate()
    const fresh = repository.loadCatalog()
    resolveOld?.(json(emptyCatalog))
    await expect(fresh).resolves.toMatchObject({ content_version: '2026.07.31-01' })
    await expect(stale).resolves.toMatchObject({ content_version: '2026.07.31-01' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('rejects unsafe or duplicate manifest paths and validates independent version logs', async () => {
    await expect(new ContentRepository(vi.fn().mockResolvedValue(json({ ...emptyManifest, files: [{ path: '../secret', kind: 'node', bytes: 0, sha256: 'a'.repeat(64) }] }))).loadContentManifest()).rejects.toMatchObject({ kind: 'malformed' })
    const repository = new ContentRepository(vi.fn()
      .mockResolvedValueOnce(json(appLog))
      .mockResolvedValueOnce(json(knowledgeLog))
      .mockResolvedValueOnce(json(emptyCatalog)))
    await expect(repository.loadAppChangelog()).resolves.toMatchObject({ current_version: '0.2.0' })
    await expect(repository.loadKnowledgeChangelog()).resolves.toMatchObject({ current_version: version })
  })
})

describe('Pagefind repository', () => {
  it('imports lazily with the project bundle path and normalizes plain results', async () => {
    const api = {
      init: vi.fn().mockResolvedValue(undefined),
      preload: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({
        results: [{ data: async () => ({ url: '/unsafe', excerpt: '<mark>命中</mark> <strong>片段</strong>', raw_content: 'x'.repeat(1000), meta: { node_id: 'normal-one' } }) }],
      }),
      filters: vi.fn().mockResolvedValue({ kind: { normal: 1 } }),
    }
    const importer = vi.fn().mockResolvedValue(api)
    const search = new SearchRepository(new ContentRepository(vi.fn()), importer)
    expect(importer).not.toHaveBeenCalled()
    await search.preload('词')
    expect(importer).toHaveBeenCalledWith('/myriad-atlas/_generated/pagefind/pagefind.js')
    expect(api.init).toHaveBeenCalledWith({
      baseUrl: '/myriad-atlas/',
      bundlePath: '/myriad-atlas/_generated/pagefind/',
    })
    await expect(search.search('词')).resolves.toEqual([{
      url: '/unsafe',
      excerpt: '命中 片段',
      meta: { node_id: 'normal-one' },
    }])
    await expect(search.filters()).resolves.toEqual({ kind: { normal: 1 } })
  })
  it('converts HTML excerpts to bounded plain text without exposing an article body', () => {
    expect(toSearchExcerpt('<p> 甲 <mark>乙</mark> </p>')).toBe('甲 乙')
    const value = toSearchExcerpt(undefined, `开头 ${'长正文'.repeat(200)}`)
    expect(value).toHaveLength(281)
    expect(value.endsWith('…')).toBe(true)
  })
  it('disposes an in-flight Pagefind import before reinitializing', async () => {
    const first = { init: vi.fn().mockResolvedValue(undefined), preload: vi.fn(), search: vi.fn(), filters: vi.fn() }
    const second = { init: vi.fn().mockResolvedValue(undefined), preload: vi.fn(), search: vi.fn(), filters: vi.fn() }
    let resolveFirst: ((api: typeof first) => void) | undefined
    const importer = vi.fn()
      .mockImplementationOnce(() => new Promise<typeof first>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(second)
    const search = new SearchRepository(new ContentRepository(vi.fn()), importer)
    const stale = search.init()
    search.invalidate()
    resolveFirst?.(first)
    await search.init()
    await stale
    expect(importer).toHaveBeenCalledTimes(2)
    expect(second.init).toHaveBeenCalledOnce()
  })
})
