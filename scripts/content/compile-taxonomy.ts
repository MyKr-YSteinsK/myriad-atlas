import type { RuntimeNode } from './compile-node'
import type { Taxonomy } from './validate-source'

export interface RuntimeTaxonomy {
  schema_version: 1
  content_version: string
  domains: Array<{ id: string; name: string; courses: Array<{ id: string; name: string; node_count: number; node_ids: string[] }> }>
}

export function compileTaxonomy(taxonomy: Taxonomy, nodes: RuntimeNode[], contentVersion: string): RuntimeTaxonomy {
  return {
    schema_version: 1,
    content_version: contentVersion,
    domains: taxonomy.domains.map((domain) => ({
      id: domain.id,
      name: domain.name,
      courses: domain.courses.map((course) => {
        const courseNodes = nodes
          .filter((node) => node.domain_id === domain.id && node.course_id === course.id)
          .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
        return { id: course.id, name: course.name, node_count: courseNodes.length, node_ids: courseNodes.map((node) => node.id) }
      }),
    })),
  }
}
