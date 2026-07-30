import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { generatedRoot, publicRoot, PROJECT_BASE_PATH } from './config'
import { findFiles, relativePosix } from './paths'
import { assertRuntimeSchema } from './runtime-validation'
import { writeJson } from './write-json'

export interface ContentManifestFile { path: string; kind: string; bytes: number; sha256: string }
export interface ContentManifest { schema_version: 1; content_version: string; base_path: string; files: ContentManifestFile[] }

function kindFor(path: string): string {
  if (path.startsWith('_generated/nodes/')) return 'node'
  if (path.startsWith('_generated/routes/')) return 'route'
  if (path.startsWith('_generated/pagefind/')) return 'pagefind'
  if (path.endsWith('catalog.json')) return 'catalog'
  if (path.endsWith('taxonomy.json')) return 'taxonomy'
  if (path.endsWith('routes.json')) return 'routes-index'
  if (path.endsWith('knowledge-changelog.json')) return 'knowledge-changelog'
  if (path.endsWith('search-status.json')) return 'search-status'
  if (path.startsWith('media/')) return 'media'
  return 'generated'
}

export async function buildManifest(contentVersion: string): Promise<ContentManifest> {
  const candidates = (await findFiles(publicRoot, '')).filter((path) => basename(path) !== 'content-manifest.json' && !basename(path).startsWith('.'))
  const files = await Promise.all(candidates.map(async (absolutePath) => {
    const bytes = await readFile(absolutePath)
    const path = relativePosix(publicRoot, absolutePath)
    return { path, kind: kindFor(path), bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  }))
  files.sort((left, right) => left.path.localeCompare(right.path))
  const manifest: ContentManifest = { schema_version: 1, content_version: contentVersion, base_path: PROJECT_BASE_PATH, files }
  await assertRuntimeSchema('content-manifest.schema.json', manifest)
  await writeJson(resolve(generatedRoot, 'content-manifest.json'), manifest)
  for (const file of files) {
    const bytes = await readFile(resolve(publicRoot, file.path))
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== file.sha256 || bytes.byteLength !== file.bytes) throw new Error(`Manifest verification failed for ${file.path}`)
  }
  return manifest
}
