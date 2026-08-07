import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBytesNoCache, verifyContentFile } from '../../scripts/release/verify-pages'

function socketFailure(): TypeError {
  const cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
  return new TypeError('fetch failed', { cause })
}

describe('Pages release verification fetches', () => {
  afterEach(() => vi.restoreAllMocks())

  it('retries transient socket failures and returns the third response', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(socketFailure())
      .mockRejectedValueOnce(socketFailure())
      .mockResolvedValueOnce(new Response('complete'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await fetchBytesNoCache('https://example.test', '/_generated/file.json', {
      fetch: fetcher,
      sleep: async () => undefined,
    })

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(new TextDecoder().decode(result.bytes)).toBe('complete')
  })

  it('does not retry an HTTP failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('missing', { status: 404 }))

    await expect(fetchBytesNoCache('https://example.test', '/missing', { fetch: fetcher })).rejects.toThrow('Pages file unavailable: /missing (HTTP 404)')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not retry a content hash mismatch after a successful download', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('bad'))

    await expect(verifyContentFile('https://example.test', {
      path: '_generated/file.json',
      bytes: 3,
      sha256: '0'.repeat(64),
    }, { fetch: fetcher })).rejects.toThrow('Pages content verification failed: _generated/file.json')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
