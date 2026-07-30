import { describe, expect, it } from 'vitest'
import { compileKnowledgeMap } from '../../scripts/content/compile-knowledge-map'

describe('runtime knowledge map', () => {
  it('is deterministic for an empty corpus', () => {
    const value = { nodes: [], routes: [], taxonomy: { schema_version: 1 as const, domains: [] }, issues: [] }
    expect(compileKnowledgeMap(value, '2026.07.30-01')).toEqual(compileKnowledgeMap(value, '2026.07.30-01'))
  })
})
