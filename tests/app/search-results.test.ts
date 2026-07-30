import { describe, expect, it } from 'vitest'
import { filterSearchResults } from '../../src/app/data/search-results'
import type { CatalogRecord } from '../../src/content/types'
import type { NodeState } from '../../src/app/state/reader-db'

const record = (id: string): CatalogRecord => ({
  id, title: id, domain_id: 'd', domain_name: '领域', course_id: 'c', course_name: '课程',
  summary: '摘要', takeaways: ['要点'], tags: [], sequence: 1, source_path: 'source',
  kind: 'normal', node_path: `_generated/nodes/${id}.json`, route_url: `#/node/${id}`,
})
const state = (id: string): NodeState => ({
  node_id: id, completed: false, completed_at: null, favorite: false, favorite_at: null, unknown: false,
  unknown_note: '', unknown_updated_at: null, uninterested: true, uninterested_note: '', uninterested_at: '',
  reading_progress: null, updated_at: '',
})

describe('search result safety', () => {
  it('keeps only catalog-backed, locally visible node IDs and ignores result URLs', () => {
    const result = filterSearchResults([
      { url: 'javascript:alert(1)', excerpt: '<img onerror=bad>', meta: { node_id: 'safe' } },
      { url: '/missing', excerpt: 'missing', meta: { node_id: 'missing' } },
      { url: '/hidden', excerpt: 'hidden', meta: { node_id: 'hidden' } },
    ], [record('safe'), record('hidden')], [state('hidden')])
    expect(result).toEqual({
      results: [{ url: 'javascript:alert(1)', excerpt: '<img onerror=bad>', meta: { node_id: 'safe' } }],
      skipped: 2,
    })
  })
})
