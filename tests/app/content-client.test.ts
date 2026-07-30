import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentClient } from '../../src/lib/content-client'
import { ContentClientError } from '../../src/lib/errors'

const emptyCatalog = { schema_version: 1, content_version: '2026.07.30-01', nodes: [] }

afterEach(() => vi.unstubAllGlobals())

describe('content client', () => {
  it('loads an empty catalog through the base path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(emptyCatalog), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new ContentClient().loadCatalog()).resolves.toEqual(emptyCatalog)
    expect(fetchMock).toHaveBeenCalledWith('/_generated/catalog.json', expect.any(Object))
  })

  it('refuses unsafe node IDs before requesting a path', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(new ContentClient().loadNode('../secret')).rejects.toMatchObject({ kind: 'missing' } satisfies Partial<ContentClientError>)
  })

  it('distinguishes missing content files from malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })))
    await expect(new ContentClient().loadCatalog()).rejects.toMatchObject({ kind: 'missing' } satisfies Partial<ContentClientError>)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{', { status: 200 })))
    await expect(new ContentClient().loadCatalog()).rejects.toMatchObject({ kind: 'malformed' } satisfies Partial<ContentClientError>)
  })
})
