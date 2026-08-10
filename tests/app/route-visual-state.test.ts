import { describe, expect, it } from 'vitest'
import type { RuntimeRoute } from '../../src/content/types'
import { continueRoute, routeProgress } from '../../src/app/data/route-progress'
import { buildRouteVisualUnits } from '../../src/app/data/route-visual-state'

const units = [
  { node_id: 'core-1', role: 'core' as const },
  { node_id: 'optional-2', role: 'optional' as const },
  { node_id: 'core-3', role: 'core' as const },
]

const route: RuntimeRoute = {
  schema_version: 1, content_version: 'v', id: 'route', code: 'R', name: '路线', summary: '摘要', core_anchor_count: 2,
  stages: [{ id: 'stage', name: '阶段', summary: '摘要', modules: [{ id: 'module', name: '模块', summary: '摘要', units: units.map((unit, index) => ({ ...unit, order: index + 1, title: unit.node_id, summary: '摘要', domain_id: 'd', course_id: 'c' })) }] }],
}

describe('route visual state', () => {
  it('does not infer optional markers from the number of completed core units', () => {
    expect(buildRouteVisualUnits(units, new Set(['core-1', 'core-3']), undefined)).toEqual([
      { role: 'core', completed: true, state: 'completed' },
      { role: 'optional', completed: false, state: 'unread' },
      { role: 'core', completed: true, state: 'completed' },
    ])
  })

  it('separates saved current position from the continuation target', () => {
    const position = { route_id: 'route', stage_id: 'stage', module_id: 'module', node_id: 'core-1', updated_at: 'now' }
    expect(continueRoute(route, new Set(['core-1']), position)?.unit.node_id).toBe('core-3')
    expect(buildRouteVisualUnits(units, new Set(['core-1']), position).map((unit) => unit.state)).toEqual(['current', 'unread', 'unread'])
  })

  it('does not promote the next incomplete node to current without a saved position', () => {
    expect(buildRouteVisualUnits(units, new Set(['core-1']), undefined).map((unit) => unit.state)).toEqual(['completed', 'unread', 'unread'])
  })

  it('keeps the saved current marker even when that node is completed', () => {
    const position = { route_id: 'route', stage_id: 'stage', module_id: 'module', node_id: 'core-3', updated_at: 'now' }
    expect(buildRouteVisualUnits(units, new Set(['core-1', 'core-3']), position)[2]).toEqual({ role: 'core', completed: true, state: 'current' })
  })

  it('leaves the formal core-only route progress unchanged', () => {
    expect(routeProgress(route, new Set(['core-1', 'optional-2']))).toEqual({ completed: 1, total: 2, ratio: .5 })
  })
})
