import { describe, expect, it } from 'vitest'
import { courseNodes, courseStats } from '../../src/app/data/library-data'
import type { CatalogRecord } from '../../src/content/types'
import type { NodeState } from '../../src/app/state/reader-db'

const records: CatalogRecord[] = [
  { id: 'b', title: '乙标题', domain_id: 'd', domain_name: '领域', course_id: 'c', course_name: '课程', summary: '第二摘要', takeaways: ['独特要点'], tags: ['two'], sequence: 2, source_path: 'b', kind: 'normal', node_path: '_generated/nodes/b.json', route_url: '#/node/b' },
  { id: 'a', title: '甲标题', domain_id: 'd', domain_name: '领域', course_id: 'c', course_name: '课程', summary: '第一摘要', takeaways: ['要点'], tags: ['one'], sequence: 1, source_path: 'a', kind: 'normal', node_path: '_generated/nodes/a.json', route_url: '#/node/a' },
  { id: 'hidden', title: '隐藏漫游', domain_id: 'd', domain_name: '领域', course_id: 'c', course_name: '课程', summary: '摘要', takeaways: ['要点'], tags: [], sequence: 3, source_path: 'h', kind: 'roaming', node_path: '_generated/nodes/hidden.json', route_url: '#/node/hidden' },
]
const state = (node_id: string, values: Partial<NodeState>): NodeState => ({
  node_id, completed: false, completed_at: null, favorite: false, favorite_at: null, unknown: false,
  unknown_note: '', unknown_updated_at: null, uninterested: false, uninterested_note: '', uninterested_at: null,
  reading_progress: null, updated_at: '', ...values,
})
const states = [
  state('a', { completed: true, favorite: true, reading_progress: { ratio: .5, anchor: '', updated_at: '2026-01-01' } }),
  state('b', { unknown: true, reading_progress: { ratio: .2, anchor: '', updated_at: '2026-02-01' } }),
  state('hidden', { uninterested: true }),
]

describe('library course data', () => {
  it('sorts by physical sequence, title, recent and incomplete status', () => {
    const options = { domainId: 'd', courseId: 'c', filter: 'all' as const, query: '' }
    expect(courseNodes(records, states, { ...options, sort: 'sequence' }).map((node) => node.id)).toEqual(['a', 'b'])
    expect(courseNodes(records, states, { ...options, sort: 'title' }).map((node) => node.id)).toEqual(['a', 'b'])
    expect(courseNodes(records, states, { ...options, sort: 'recent' }).map((node) => node.id)).toEqual(['b', 'a'])
    expect(courseNodes(records, states, { ...options, sort: 'incomplete' }).map((node) => node.id)).toEqual(['b', 'a'])
  })
  it('filters states and searches metadata without including uninterested nodes', () => {
    const base = { domainId: 'd', courseId: 'c', sort: 'sequence' as const }
    expect(courseNodes(records, states, { ...base, filter: 'favorite', query: '' }).map((node) => node.id)).toEqual(['a'])
    expect(courseNodes(records, states, { ...base, filter: 'unknown', query: '' }).map((node) => node.id)).toEqual(['b'])
    expect(courseNodes(records, states, { ...base, filter: 'incomplete', query: '' }).map((node) => node.id)).toEqual(['b'])
    expect(courseNodes(records, states, { ...base, filter: 'all', query: '独特要点' }).map((node) => node.id)).toEqual(['b'])
  })
  it('computes course state totals', () => {
    expect(courseStats(records, states, 'c')).toEqual({ total: 3, completed: 1, favorite: 1, unknown: 1 })
  })
})
