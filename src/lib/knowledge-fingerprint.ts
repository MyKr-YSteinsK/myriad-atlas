export interface KnowledgeFingerprintFile {
  path: string
  kind: string
  bytes: number
  sha256: string
}

export interface KnowledgeFingerprintManifest {
  content_version: string
  files: readonly KnowledgeFingerprintFile[]
}

const KNOWLEDGE_KINDS = new Set([
  'catalog',
  'taxonomy',
  'routes-index',
  'route',
  'qa-index',
  'knowledge-map',
  'knowledge-changelog',
  'node',
  'media',
])

export function canonicalKnowledgeFingerprint(manifest: KnowledgeFingerprintManifest): string {
  const files = manifest.files
    .filter((file) => KNOWLEDGE_KINDS.has(file.kind))
    .slice()
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  return `${manifest.content_version}\n${files.map((file) => `${file.path}\t${file.kind}\t${file.bytes}\t${file.sha256}`).join('\n')}\n`
}

export async function knowledgeFingerprint(manifest: KnowledgeFingerprintManifest): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalKnowledgeFingerprint(manifest))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
