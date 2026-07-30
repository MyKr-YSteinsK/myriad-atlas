export interface TocEntry { id: string; depth: number; text: string }
export interface RuntimeNode {
  schema_version: 1
  content_version: string
  id: string
  title: string
  domain_id: string
  domain_name: string
  course_id: string
  course_name: string
  summary: string
  takeaways: string[]
  tags: string[]
  prerequisites: string[]
  related: string[]
  self_check: Array<{ question: string; answer_html: string }>
  body_html: string
  toc: TocEntry[]
  plain_text: string
  media: string[]
  source_path: string
  sequence: number
  qa?: QaMetadata
}

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
export interface QaMetadata {
  chain_id: string
  root_node_id: string
  parent_node_id: string | null
  source_content_version: string
  prompt: string
}
export interface RuntimeTaxonomy {
  schema_version: 1
  content_version: string
  domains: Array<{
    id: string
    name: string
    courses: Array<{ id: string; name: string; node_count: number; node_ids: string[] }>
  }>
}
export interface RuntimeRouteUnit {
  node_id: string
  role: 'core' | 'optional' | 'anchor'
  order: number
  title: string
  summary: string
  domain_id: string
  course_id: string
}
export interface RuntimeRoute {
  schema_version: 1
  content_version: string
  id: string
  code: string
  name: string
  summary: string
  core_anchor_count: number
  stages: Array<{
    id: string
    name: string
    summary: string
    modules: Array<{ id: string; name: string; summary: string; units: RuntimeRouteUnit[] }>
  }>
}
export interface RuntimeRoutesIndex {
  schema_version: 1
  content_version: string
  routes: Array<{ id: string; code: string; name: string; summary: string; route_path: string; core_anchor_count: number }>
}
export interface RuntimeQaIndex {
  schema_version: 1
  content_version: string
  chains: Array<{
    chain_id: string
    root_node_id: string
    answers: Array<{
      node_id: string
      parent_node_id: string | null
      prompt: string
      title: string
      source_content_version: string
      node_path: string
    }>
  }>
}
export interface SearchStatus { schema_version: 1; available: false; reason: 'empty-corpus' }
