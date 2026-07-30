import type { RuntimeNode } from './compile-node'
import type { SourceRoute, Taxonomy } from './validate-source'

export interface CatalogRecord {
  id: string
  title: string
  domain_id: string
  domain_name: string
  course_id: string
  course_name: string
  summary: string
  takeaways: string[]
  tags: string[]
  sequence: number
  source_path: string
  kind: 'normal' | 'roaming' | 'qa' | 'anchor'
  node_path: string
  route_url: string
}
export interface RuntimeCatalog { schema_version: 1; content_version: string; nodes: CatalogRecord[] }

export function compileCatalog(nodes: RuntimeNode[], taxonomy: Taxonomy, routes: SourceRoute[], contentVersion: string): RuntimeCatalog {
  const domainOrder = new Map(taxonomy.domains.map((domain, index) => [domain.id, index]))
  const courseOrder = new Map(taxonomy.domains.flatMap((domain) => domain.courses.map((course, index) => [course.id, index])))
  const anchors = new Set(routes.flatMap((route) => route.stages.flatMap((stage) => stage.modules.flatMap((module) => module.units.filter((unit) => unit.role === 'anchor').map((unit) => unit.node_id)))))
  const records = nodes.map((node): CatalogRecord => ({
    id: node.id,
    title: node.title,
    domain_id: node.domain_id,
    domain_name: node.domain_name,
    course_id: node.course_id,
    course_name: node.course_name,
    summary: node.summary,
    takeaways: node.takeaways,
    tags: node.tags,
    sequence: node.sequence,
    source_path: node.source_path,
    kind: anchors.has(node.id) ? 'anchor' : node.qa ? 'qa' : node.domain_id === 'knowledge-roaming' ? 'roaming' : 'normal',
    node_path: `_generated/nodes/${node.id}.json`,
    route_url: `#/node/${encodeURIComponent(node.id)}`,
  }))
  records.sort((left, right) => (domainOrder.get(left.domain_id) ?? Number.MAX_SAFE_INTEGER) - (domainOrder.get(right.domain_id) ?? Number.MAX_SAFE_INTEGER)
    || (courseOrder.get(left.course_id) ?? Number.MAX_SAFE_INTEGER) - (courseOrder.get(right.course_id) ?? Number.MAX_SAFE_INTEGER)
    || left.sequence - right.sequence || left.id.localeCompare(right.id))
  return { schema_version: 1, content_version: contentVersion, nodes: records }
}
