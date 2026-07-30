import type { RuntimeNode } from './compile-node'
import type { SourceRoute } from './validate-source'

export interface RuntimeRoute {
  schema_version: 1
  content_version: string
  id: string
  code: string
  name: string
  summary: string
  core_anchor_count: number
  stages: Array<{ id: string; name: string; summary: string; modules: Array<{ id: string; name: string; summary: string; units: Array<{ node_id: string; role: string; order: number; title: string; summary: string; domain_id: string; course_id: string }> }> }>
}

export function compileRoutes(routes: SourceRoute[], nodes: RuntimeNode[], contentVersion: string): RuntimeRoute[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return routes.map((route) => {
    const units = route.stages.flatMap((stage) => stage.modules.flatMap((module) => module.units))
    return {
      schema_version: 1,
      content_version: contentVersion,
      id: route.id,
      code: route.code,
      name: route.name,
      summary: route.summary,
      core_anchor_count: units.filter((unit) => unit.role !== 'optional').length,
      stages: route.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        summary: stage.summary,
        modules: stage.modules.map((module) => ({
          id: module.id,
          name: module.name,
          summary: module.summary,
          units: [...module.units].sort((left, right) => left.order - right.order).map((unit) => {
            const node = byId.get(unit.node_id)
            if (!node) throw new Error(`Cannot enrich route ${route.id}; node ${unit.node_id} is missing`)
            return { ...unit, title: node.title, summary: node.summary, domain_id: node.domain_id, course_id: node.course_id }
          }),
        })),
      })),
    }
  })
}
