import type { CatalogRecord, RuntimeCatalog, RuntimeKnowledgeMap, RuntimeRoutesIndex, RuntimeTaxonomy } from '../../content/types'

export interface KnowledgeMapNodeView {
  id: string
  title: string
  summary: string
  domainId: string
  domainName: string
  courseId: string
  courseName: string
  sequence: number
  kind: 'normal' | 'roaming' | 'qa'
  tags: string[]
}
export interface KnowledgeMapRouteView { id: string; code: string; name: string; summary: string; nodeIds: string[] }
export interface KnowledgeMapViewModel {
  contentVersion: string
  nodes: KnowledgeMapNodeView[]
  edges: RuntimeKnowledgeMap['edges']
  routes: KnowledgeMapRouteView[]
  domains: RuntimeTaxonomy['domains']
}

function fail(message: string): never { throw new Error(`知识地图数据不一致：${message}`) }

export function buildKnowledgeMapViewModel(map: RuntimeKnowledgeMap, catalog: RuntimeCatalog, taxonomy: RuntimeTaxonomy, routes: RuntimeRoutesIndex): KnowledgeMapViewModel {
  if (![catalog.content_version, taxonomy.content_version, routes.content_version].every((version) => version === map.content_version)) fail('运行时数据版本不一致。')
  const catalogById = new Map(catalog.nodes.map((node) => [node.id, node]))
  const mapIds = new Set(map.nodes.map((node) => node.id))
  const missingCatalog = map.nodes.find((node) => !catalogById.has(node.id))
  const missingMap = catalog.nodes.find((node) => !mapIds.has(node.id))
  if (missingCatalog) fail(`图节点 ${missingCatalog.id} 不在目录中。`)
  if (missingMap) fail(`目录节点 ${missingMap.id} 不在图中。`)
  const taxonomyCourses = new Map(taxonomy.domains.flatMap((domain) => domain.courses.map((course) => [`${domain.id}/${course.id}`, { domain, course }] as const)))
  const nodes = map.nodes.map((node) => {
    const record = catalogById.get(node.id) as CatalogRecord
    const hierarchy = taxonomyCourses.get(`${node.domain_id}/${node.course_id}`)
    if (!hierarchy) fail(`节点 ${node.id} 的领域或课程不存在。`)
    if (record.domain_id !== node.domain_id || record.course_id !== node.course_id || record.sequence !== node.sequence) fail(`节点 ${node.id} 的目录元数据与图结构不一致。`)
    return { id: node.id, title: record.title, summary: record.summary, domainId: node.domain_id, domainName: record.domain_name || hierarchy.domain.name, courseId: node.course_id, courseName: record.course_name || hierarchy.course.name, sequence: node.sequence, kind: node.kind, tags: record.tags }
  }).sort((left, right) => left.domainName.localeCompare(right.domainName, 'zh-CN') || left.courseName.localeCompare(right.courseName, 'zh-CN') || left.sequence - right.sequence)
  const routeIndex = new Map(routes.routes.map((route) => [route.id, route]))
  const mapRouteIds = new Set(map.routes.map((route) => route.id))
  const missingRoute = map.routes.find((route) => !routeIndex.has(route.id))
  const extraRoute = routes.routes.find((route) => !mapRouteIds.has(route.id))
  if (missingRoute) fail(`图路线 ${missingRoute.id} 不在路线索引中。`)
  if (extraRoute) fail(`路线索引 ${extraRoute.id} 不在图中。`)
  const routeViews = map.routes.map((route) => {
    const record = routeIndex.get(route.id)!
    if (record.code !== route.code) fail(`路线 ${route.id} 的 code 不一致。`)
    if (route.node_ids.some((id) => !mapIds.has(id))) fail(`路线 ${route.id} 引用了不存在的节点。`)
    return { id: route.id, code: record.code, name: record.name, summary: record.summary, nodeIds: route.node_ids }
  })
  for (const edge of map.edges) {
    const nodeEdge = edge.type !== 'route'
    if (nodeEdge && (!mapIds.has(edge.from) || !mapIds.has(edge.to))) fail(`关系 ${edge.type} 引用了不存在的节点。`)
    if (edge.type === 'route' && (!mapRouteIds.has(edge.from) || !mapIds.has(edge.to) || !edge.route_id || !mapRouteIds.has(edge.route_id))) fail('路线关系引用无效。')
  }
  return { contentVersion: map.content_version, nodes, edges: map.edges, routes: routeViews, domains: taxonomy.domains }
}

export function mapFilters(search: URLSearchParams, view: KnowledgeMapViewModel): { domain: string; course: string; route: string; node: string } {
  const domain = search.get('domain') ?? ''
  const course = search.get('course') ?? ''
  const route = search.get('route') ?? ''
  const node = search.get('node') ?? ''
  if (domain && !view.domains.some((entry) => entry.id === domain)) return { domain: '', course: '', route: '', node: '' }
  if (course && !view.nodes.some((entry) => entry.domainId === domain && entry.courseId === course)) return { domain, course: '', route: '', node: '' }
  if (route && !view.routes.some((entry) => entry.id === route)) return { domain, course, route: '', node: '' }
  if (node && !view.nodes.some((entry) => entry.id === node)) return { domain, course, route, node: '' }
  return { domain, course, route, node }
}
