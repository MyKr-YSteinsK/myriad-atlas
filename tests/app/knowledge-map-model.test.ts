import { describe, expect, it } from 'vitest'
import { buildKnowledgeMapViewModel, mapFilters } from '../../src/app/data/knowledge-map-model'
import type { RuntimeCatalog, RuntimeKnowledgeMap, RuntimeRoutesIndex, RuntimeTaxonomy } from '../../src/content/types'

const map: RuntimeKnowledgeMap = { schema_version: 1, content_version: '2026.08.01-01', domains: [{ id: 'science', name: '科学', courses: [{ id: 'light', name: '光学', node_ids: ['sky', 'sunset'] }] }], nodes: [{ id: 'sky', domain_id: 'science', course_id: 'light', sequence: 1, kind: 'normal' }, { id: 'sunset', domain_id: 'science', course_id: 'light', sequence: 2, kind: 'normal' }], edges: [{ type: 'prerequisite', from: 'sky', to: 'sunset' }, { type: 'route', from: 'light-route', to: 'sky', route_id: 'light-route', role: 'core' }], routes: [{ id: 'light-route', code: 'LIGHT', node_ids: ['sky'] }], qa_chains: [] }
const catalog: RuntimeCatalog = { schema_version: 1, content_version: map.content_version, nodes: [{ id: 'sky', title: '天空为什么蓝', summary: '来自目录的摘要。', domain_id: 'science', domain_name: '科学', course_id: 'light', course_name: '光学', takeaways: [], tags: ['光'], sequence: 1, source_path: 'src/content/sky.md', kind: 'normal', node_path: '_generated/nodes/sky.json', route_url: '/route/light-route' }, { id: 'sunset', title: '日落为什么红', summary: '另一条目录摘要。', domain_id: 'science', domain_name: '科学', course_id: 'light', course_name: '光学', takeaways: [], tags: [], sequence: 2, source_path: 'src/content/sunset.md', kind: 'normal', node_path: '_generated/nodes/sunset.json', route_url: '/route/light-route' }] }
const taxonomy: RuntimeTaxonomy = { schema_version: 1, content_version: map.content_version, domains: [{ id: 'science', name: '科学', courses: [{ id: 'light', name: '光学', node_count: 2, node_ids: ['sky', 'sunset'] }] }] }
const routes: RuntimeRoutesIndex = { schema_version: 1, content_version: map.content_version, routes: [{ id: 'light-route', code: 'LIGHT', name: '光线路线', summary: '来自路线索引的名称。', route_path: '_generated/routes/light-route.json', core_anchor_count: 1 }] }

describe('knowledge map view model', () => {
  it('joins display metadata while retaining graph relationships and route names', () => {
    const view = buildKnowledgeMapViewModel(map, catalog, taxonomy, routes)
    expect(view.nodes[0]).toMatchObject({ title: '天空为什么蓝', summary: '来自目录的摘要。' })
    expect(view.edges).toContainEqual({ type: 'prerequisite', from: 'sky', to: 'sunset' })
    expect(view.routes).toContainEqual(expect.objectContaining({ id: 'light-route', name: '光线路线', code: 'LIGHT' }))
  })

  it('restores a focused node from validated URL state', () => {
    const view = buildKnowledgeMapViewModel(map, catalog, taxonomy, routes)
    expect(mapFilters(new URLSearchParams('domain=science&course=light&route=light-route&node=sunset'), view)).toEqual({ domain: 'science', course: 'light', route: 'light-route', node: 'sunset' })
  })
})
