import { readFile, writeFile } from 'node:fs/promises'

export interface ContentTombstonesV1 {
  schema_version: 1
  node_ids: string[]
  qa_chain_ids: string[]
  roaming_sequences: string[]
  qa_sequences: string[]
}

export const EMPTY_TOMBSTONES: ContentTombstonesV1 = { schema_version: 1, node_ids: [], qa_chain_ids: [], roaming_sequences: [], qa_sequences: [] }

function sorted(values: Iterable<string>): string[] { return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en')) }

export function normalizeTombstones(value: unknown): ContentTombstonesV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('内容 tombstone 无效')
  const source = value as Partial<ContentTombstonesV1>
  if (source.schema_version !== 1 || !Array.isArray(source.node_ids) || !Array.isArray(source.qa_chain_ids) || !Array.isArray(source.roaming_sequences) || !Array.isArray(source.qa_sequences) || [source.node_ids, source.qa_chain_ids, source.roaming_sequences, source.qa_sequences].some((list) => list.some((entry) => typeof entry !== 'string' || !entry))) throw new Error('内容 tombstone 结构无效')
  return { schema_version: 1, node_ids: sorted(source.node_ids), qa_chain_ids: sorted(source.qa_chain_ids), roaming_sequences: sorted(source.roaming_sequences), qa_sequences: sorted(source.qa_sequences) }
}

export async function readTombstones(path: string): Promise<ContentTombstonesV1> {
  const source = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? JSON.stringify(EMPTY_TOMBSTONES) : Promise.reject(error))
  return normalizeTombstones(JSON.parse(source))
}

export async function writeTombstones(path: string, value: ContentTombstonesV1): Promise<void> {
  await writeFile(path, `${JSON.stringify(normalizeTombstones(value), null, 2)}\n`, 'utf8')
}

export function extendTombstones(current: ContentTombstonesV1, additions: Partial<ContentTombstonesV1>): ContentTombstonesV1 {
  return normalizeTombstones({ schema_version: 1, node_ids: [...current.node_ids, ...(additions.node_ids ?? [])], qa_chain_ids: [...current.qa_chain_ids, ...(additions.qa_chain_ids ?? [])], roaming_sequences: [...current.roaming_sequences, ...(additions.roaming_sequences ?? [])], qa_sequences: [...current.qa_sequences, ...(additions.qa_sequences ?? [])] })
}
