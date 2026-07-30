import Ajv2020 from 'ajv/dist/2020.js'
import batchSchema from '../../schemas/batch/knowledge-batch-v1.schema.json'

export const BATCH_LIMITS = {
  maxZipBytes: 150 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 750 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxBatchManifestBytes: 2 * 1024 * 1024,
  maxMarkdownBytes: 5 * 1024 * 1024,
  maxRouteBytes: 2 * 1024 * 1024,
} as const

export const BATCH_ID_PATTERN = /^batch-\d{8}-\d{3}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/
export const ALLOWED_MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'])

export interface KnowledgeBatchOperationV1 {
  operation_id: string
  action: 'add' | 'replace' | 'delete'
  kind: 'node' | 'route' | 'media'
  path: string
  entity_id: string
  reason?: string
  move_from?: string
  payload_sha256?: string
  expected_previous_sha256?: string
  delete_mode?: 'single-node' | 'roaming-node' | 'qa-chain' | 'qa-descendants' | 'route' | 'media'
  chain_id?: string
  from_node_id?: string
  expected_descendant_ids?: string[]
}

export interface KnowledgeBatchV1 {
  schema_version: 1
  batch_id: string
  created_at: string
  released_on: string
  base_content_version: string
  target_content_version: string
  summary: string
  operations: KnowledgeBatchOperationV1[]
}

const validator = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(batchSchema as object)

export function validateKnowledgeBatch(value: unknown): value is KnowledgeBatchV1 {
  return Boolean(validator(value))
}

export function knowledgeBatchValidationMessage(): string {
  return validator.errors?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`).join('; ') ?? '知识批次结构无效。'
}

function reservedWindowsSegment(segment: string): boolean {
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
}

/** Validates a canonical repository-relative path before it reaches the filesystem. */
export function validateBatchPath(path: string): string | undefined {
  if (path !== path.normalize('NFC') || !path || path.length > 1024 || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return undefined
  const segments = path.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || [...segment].some((character) => character.codePointAt(0)! <= 0x1f) || /[. ]$/.test(segment) || reservedWindowsSegment(segment))) return undefined
  return path
}

export function payloadPaths(manifest: KnowledgeBatchV1): Set<string> {
  return new Set(manifest.operations.filter((operation) => operation.action !== 'delete').map((operation) => operation.path))
}
