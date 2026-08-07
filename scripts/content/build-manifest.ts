import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generatedRoot, mediaRoot, PROJECT_BASE_PATH } from './config'
import { findFiles, relativePosix } from './paths'
import { assertRuntimeSchema } from './runtime-validation'
import { writeJson } from './write-json'

export interface ContentManifestFile { path: string; kind: string; bytes: number; sha256: string }
export interface ContentManifest { schema_version: 1; content_version: string; base_path: string; files: ContentManifestFile[] }

const excludedPublishNames = new Set(['.gitkeep', '.ds_store', 'thumbs.db', 'desktop.ini'])

export function isPublishedContentFile(root: string, absolutePath: string): boolean {
  return relativePosix(root, absolutePath).split('/').every((segment) => !segment.startsWith('.') && !excludedPublishNames.has(segment.toLowerCase()))
}

export function kindFor(path: string): string {
  if (path.startsWith('_generated/nodes/')) return 'node'
  if (path.startsWith('_generated/routes/')) return 'route'
  if (path.startsWith('_generated/pagefind/')) return 'pagefind'
  if (path.endsWith('catalog.json')) return 'catalog'
  if (path.endsWith('taxonomy.json')) return 'taxonomy'
  if (path.endsWith('routes.json')) return 'routes-index'
  if (path.endsWith('qa-index.json')) return 'qa-index'
  if (path.endsWith('knowledge-map.json')) return 'knowledge-map'
  if (path.endsWith('knowledge-changelog.json')) return 'knowledge-changelog'
  if (path.endsWith('app-changelog.json')) return 'app-changelog'
  if (path.endsWith('search-status.json')) return 'search-status'
  if (path.startsWith('media/')) return 'media'
  return 'generated'
}

export async function buildManifest(
  contentVersion: string,
  outputRoot = generatedRoot,
  contentMediaRoot = mediaRoot,
): Promise<ContentManifest> {
  const generatedCandidates = (await findFiles(outputRoot, '')).filter((path) => {
    const relativePath = relativePosix(outputRoot, path)
    return relativePath !== 'content-manifest.json' && relativePath !== 'app-changelog.json' && isPublishedContentFile(outputRoot, path)
  })
  const mediaCandidates = (await findFiles(contentMediaRoot, '')).filter((path) => isPublishedContentFile(contentMediaRoot, path))
  const files = await Promise.all([...generatedCandidates, ...mediaCandidates].map(async (absolutePath) => {
    const bytes = await readFile(absolutePath)
    const path = absolutePath.startsWith(outputRoot)
      ? `_generated/${relativePosix(outputRoot, absolutePath)}`
      : `media/${relativePosix(contentMediaRoot, absolutePath)}`
    return { path, kind: kindFor(path), bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  }))
  files.sort((left, right) => left.path.localeCompare(right.path))
  const manifest: ContentManifest = { schema_version: 1, content_version: contentVersion, base_path: PROJECT_BASE_PATH, files }
  await assertRuntimeSchema('content-manifest.schema.json', manifest)
  await writeJson(resolve(outputRoot, 'content-manifest.json'), manifest)
  for (const file of files) {
    const bytes = await readFile(file.path.startsWith('_generated/')
      ? resolve(outputRoot, file.path.slice('_generated/'.length))
      : resolve(contentMediaRoot, file.path.slice('media/'.length)))
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== file.sha256 || bytes.byteLength !== file.bytes) throw new Error(`Manifest verification failed for ${file.path}`)
  }
  return manifest
}
