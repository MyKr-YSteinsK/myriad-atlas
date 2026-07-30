import type { RuntimeCatalog, RuntimeRoutesIndex, RuntimeTaxonomy } from '../../content/types'

export type NodeSource = 'route' | 'course' | 'roaming' | 'search' | 'home'
export type NodeContext =
  | { source: 'route'; routeId: string; stageId: string; moduleId: string }
  | { source: 'course'; domainId: string; courseId: string }
  | { source: 'roaming' | 'search' | 'home' }
  | undefined

export function parseNodeContext(
  parameters: URLSearchParams,
  data: { catalog: RuntimeCatalog; taxonomy: RuntimeTaxonomy; routes: RuntimeRoutesIndex },
): NodeContext {
  const source = parameters.get('source')
  if (source === 'roaming' || source === 'search' || source === 'home') return { source }
  if (source === 'course') {
    const domainId = parameters.get('domain') ?? ''
    const courseId = parameters.get('course') ?? ''
    const domain = data.taxonomy.domains.find((entry) => entry.id === domainId)
    if (domain?.courses.some((entry) => entry.id === courseId)) return { source, domainId, courseId }
  }
  if (source === 'route') {
    const routeId = parameters.get('route') ?? ''
    const stageId = parameters.get('stage') ?? ''
    const moduleId = parameters.get('module') ?? ''
    if (data.routes.routes.some((entry) => entry.id === routeId) && stageId && moduleId) {
      return { source, routeId, stageId, moduleId }
    }
  }
  return undefined
}
