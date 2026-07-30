import { describe, expect, it } from 'vitest'
import { continueRoute, routeProgress } from '../../src/app/data/route-progress'
import type { RuntimeRoute } from '../../src/content/types'

const route: RuntimeRoute = {
  schema_version: 1, content_version: 'v', id: 'route', code: 'R', name: '路线', summary: '摘要', core_anchor_count: 3,
  stages: [
    { id: 's1', name: '阶段一', summary: '摘要', modules: [
      { id: 'm1', name: '模块一', summary: '摘要', units: [
        { node_id: 'core-1', role: 'core', order: 1, title: '一', summary: '一', domain_id: 'd', course_id: 'c' },
        { node_id: 'optional', role: 'optional', order: 2, title: '可选', summary: '可选', domain_id: 'd', course_id: 'c' },
      ] },
    ] },
    { id: 's2', name: '阶段二', summary: '摘要', modules: [
      { id: 'm2', name: '模块二', summary: '摘要', units: [
        { node_id: 'anchor', role: 'anchor', order: 1, title: '综合', summary: '综合', domain_id: 'd', course_id: 'c' },
        { node_id: 'shared', role: 'core', order: 2, title: '共享', summary: '共享', domain_id: 'd', course_id: 'c' },
      ] },
    ] },
  ],
}

describe('route continuation', () => {
  it('excludes optional nodes from progress and automatic targets', () => {
    expect(routeProgress(route, new Set(['core-1', 'optional']))).toEqual({ completed: 1, total: 3, ratio: 1 / 3 })
    expect(continueRoute(route, new Set(['core-1']), {
      route_id: 'route', stage_id: 's1', module_id: 'm1', node_id: 'core-1', updated_at: 'now',
    })?.unit.node_id).toBe('anchor')
  })
  it('restores an incomplete current node and reaches a completed summary', () => {
    expect(continueRoute(route, new Set(), {
      route_id: 'route', stage_id: 's2', module_id: 'm2', node_id: 'anchor', updated_at: 'now',
    })?.unit.node_id).toBe('anchor')
    expect(continueRoute(route, new Set(['core-1', 'anchor', 'shared']))).toBeUndefined()
  })
  it('falls back safely when the saved position no longer exists', () => {
    expect(continueRoute(route, new Set(['core-1']), {
      route_id: 'route', stage_id: 'removed', module_id: 'removed', node_id: 'removed', updated_at: 'now',
    })?.unit.node_id).toBe('anchor')
  })
})
