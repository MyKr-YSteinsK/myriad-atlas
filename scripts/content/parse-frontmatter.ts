import { parseDocument } from 'yaml'

export interface ParsedFrontmatter {
  data: Record<string, unknown>
  body: string
}

export class FrontmatterParseError extends Error {}

export function parseFrontmatter(input: string): ParsedFrontmatter {
  const normalized = input.startsWith('\uFEFF') ? input.slice(1) : input
  if (!normalized.startsWith('---\n')) {
    throw new FrontmatterParseError('Frontmatter must start on the first line with ---')
  }

  const end = normalized.indexOf('\n---\n', 4)
  if (end === -1) throw new FrontmatterParseError('Frontmatter closing --- is missing')

  const document = parseDocument(normalized.slice(4, end), { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new FrontmatterParseError([...document.errors, ...document.warnings].map((entry) => entry.message).join('; '))
  }

  const data = document.toJS()
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new FrontmatterParseError('Frontmatter must be a YAML mapping')
  }
  return { data: data as Record<string, unknown>, body: normalized.slice(end + 5) }
}
