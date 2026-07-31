import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAllContent } from '../../scripts/content/build-all'
import { renderKnowledgeMap } from '../../scripts/content/build-knowledge-map'
import { validateSource } from '../../scripts/content/validate-source'

describe('runtime content artifacts', () => {
  it('builds the formal corpus with a Pagefind search index', async () => {
    await buildAllContent()
    const root = resolve(process.cwd(), 'public/_generated')
    const catalog = JSON.parse(await readFile(resolve(root, 'catalog.json'), 'utf8')) as { nodes: unknown[] }
    const qaIndex = JSON.parse(await readFile(resolve(root, 'qa-index.json'), 'utf8')) as { chains: unknown[] }
    const manifest = JSON.parse(await readFile(resolve(root, 'content-manifest.json'), 'utf8')) as { files: Array<{ path: string; kind: string }> }

    expect(catalog.nodes).toHaveLength(3)
    expect(qaIndex.chains).toEqual([])
    await expect(readFile(resolve(root, 'search-status.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(resolve(root, 'pagefind'))).toContain('pagefind.js')
    expect(manifest.files.map((file) => file.path)).not.toContain('_generated/content-manifest.json')
    expect(manifest.files).toContainEqual(expect.objectContaining({ path: '_generated/qa-index.json', kind: 'qa-index' }))
  })

  it('renders a deterministic knowledge map for the formal library', async () => {
    const first = renderKnowledgeMap(await validateSource(), '2026.08.01-01')
    const second = renderKnowledgeMap(await validateSource(), '2026.08.01-01')

    expect(first).toBe(second)
    expect(first).toContain('LIGHT01')
  })
})
