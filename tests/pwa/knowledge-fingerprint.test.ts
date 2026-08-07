import { describe, expect, it } from 'vitest'
import { canonicalKnowledgeFingerprint, knowledgeFingerprint } from '../../src/lib/knowledge-fingerprint'

const file = (path: string, kind: string, sha256 = 'a'.repeat(64)) => ({ path, kind, bytes: 12, sha256 })
const base = {
  content_version: '2026.08.01-01',
  files: [
    file('_generated/catalog.json', 'catalog'),
    file('_generated/nodes/light.json', 'node', 'b'.repeat(64)),
    file('media/light.png', 'media', 'c'.repeat(64)),
  ],
}

describe('knowledge fingerprints', () => {
  it('is stable across ordering and derived Pagefind artifacts', async () => {
    const rebuilt = {
      ...base,
      files: [
        file('_generated/pagefind/chunk-b.pf_index', 'pagefind', 'd'.repeat(64)),
        file('_generated/app-changelog.json', 'app-changelog', 'e'.repeat(64)),
        ...[...base.files].reverse(),
      ],
    }

    expect(canonicalKnowledgeFingerprint(base)).toBe(canonicalKnowledgeFingerprint(rebuilt))
    await expect(knowledgeFingerprint(base)).resolves.toBe(await knowledgeFingerprint(rebuilt))
  })

  it('keeps legacy app changelog entries out of the knowledge identity', async () => {
    const legacy = { ...base, files: [...base.files, file('_generated/app-changelog.json', 'app-changelog', 'f'.repeat(64))] }

    await expect(knowledgeFingerprint(legacy)).resolves.toBe(await knowledgeFingerprint(base))
  })

  it('changes when a node or media artifact changes', async () => {
    const nodeChanged = { ...base, files: [base.files[0], file('_generated/nodes/light.json', 'node', '1'.repeat(64)), base.files[2]] }
    const mediaChanged = { ...base, files: [base.files[0], base.files[1], file('media/light.png', 'media', '2'.repeat(64))] }
    const original = await knowledgeFingerprint(base)

    await expect(knowledgeFingerprint(nodeChanged)).resolves.not.toBe(original)
    await expect(knowledgeFingerprint(mediaChanged)).resolves.not.toBe(original)
  })
})
