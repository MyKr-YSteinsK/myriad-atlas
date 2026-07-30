export interface TocEntry { id: string; depth: number; text: string }
export interface RuntimeNode {
  schema_version: number
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

export interface RuntimeCatalog { schema_version: number; content_version: string; nodes: CatalogRecord[] }
