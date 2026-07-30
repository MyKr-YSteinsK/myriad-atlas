import { describe, expect, it, vi } from 'vitest'
import { ContentRepository } from '../../src/lib/content-client'
import { ContentClientError } from '../../src/lib/errors'
import { SearchRepository } from '../../src/lib/search-repository'

const version = '2026.07.30-01'
const emptyCatalog = { schema_version: 1, content_version: version, nodes: [] }
const emptyTaxonomy = { schema_version: 1, content_version: version, domains: [] }
const emptyRoutes = { schema_version: 1, content_version: version, routes: [] }
const emptyQa = { schema_version: 1, content_version: version, chains: [] }

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

  it('passes AbortSignal to fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(emptyCatalog))
    const signal = new AbortController().signal
    await new ContentRepository(fetcher).loadCatalog(signal)
    expect(fetcher).toHaveBeenCalledWith('/myriad-atlas/_generated/catalog.json', { signal })
  })
})

describe('Pagefind repository', () => {
  it('imports lazily with the project bundle path and normalizes plain results', async () => {
    const api = {
      init: vi.fn().mockResolvedValue(undefined),
      preload: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({
        results: [{ data: async () => ({ url: '/unsafe', raw_content: 'plain excerpt', meta: { node_id: 'normal-one' } }) }],
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
      excerpt: 'plain excerpt',
      meta: { node_id: 'normal-one' },
    }])
    await expect(search.filters()).resolves.toEqual({ kind: { normal: 1 } })
  })
})
