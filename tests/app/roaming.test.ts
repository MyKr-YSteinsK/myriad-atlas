import { describe, expect, it, vi } from 'vitest'
import { pickRoaming, roamingEmptyReason, roamingPool, secureRandomIndex } from '../../src/app/data/roaming'
import type { CatalogRecord } from '../../src/content/types'
import type { NodeState } from '../../src/app/state/reader-db'

const node = (id: string): CatalogRecord => ({
  id, title: id, domain_id: 'knowledge-roaming', domain_name: '知识漫游', course_id: 'knowledge-roaming-pool',
  course_name: '知识漫游池', summary: '摘要', takeaways: ['要点'], tags: [], sequence: 1, source_path: id,
  kind: 'roaming', node_path: `_generated/nodes/${id}.json`, route_url: `#/node/${id}`,
})
const state = (id: string, values: Partial<NodeState>): NodeState => ({
  node_id: id, completed: false, completed_at: null, favorite: false, favorite_at: null,
  unknown: false, unknown_note: '', unknown_updated_at: null, uninterested: false, uninterested_note: '',
  uninterested_at: null, reading_progress: null, updated_at: '', ...values,
})

describe('knowledge roaming', () => {
  it('uses only unread and interested roaming nodes', () => {
    const catalog = [node('a'), node('b'), node('c')]
    expect(roamingPool(catalog, [state('a', { completed: true }), state('b', { uninterested: true })]).map((entry) => entry.id)).toEqual(['c'])
    expect(roamingEmptyReason([], [])).toBe('no-content')
    expect(roamingEmptyReason(catalog, catalog.map((entry) => state(entry.id, { completed: true })))).toBe('all-read')
    expect(roamingEmptyReason(catalog, catalog.map((entry) => state(entry.id, { uninterested: true })))).toBe('all-uninterested')
  })
  it('rejects biased overflow values and excludes the current candidate', () => {
    const values = [0xffff_ffff, 1]
    const cryptoApi = { getRandomValues: vi.fn((array: Uint32Array<ArrayBuffer>) => { array[0] = values.shift()!; return array }) }
    expect(secureRandomIndex(3, cryptoApi)).toBe(1)
    expect(cryptoApi.getRandomValues).toHaveBeenCalledTimes(2)
    expect(pickRoaming([node('a'), node('b')], 'a', { getRandomValues(array) { array[0] = 0; return array } })?.id).toBe('b')
  })
})
