import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { parse } from 'yaml'
import { parseFrontmatter } from '../content/parse-frontmatter'
import { findFiles } from '../content/paths'
import type { KnowledgeBatchOperationV1 } from '../../src/import/knowledge-batch'
import type { ScannedBatch } from './scan-batch'
import { extendTombstones, readTombstones, writeTombstones, type ContentTombstonesV1 } from '../../src/import/content-tombstones'

export interface TransactionFileRecord {
  path: string
  existed: boolean
  sha256?: string
  backup?: string
  applied: boolean
  restored: boolean
}

export interface KnowledgeTransactionJournal {
  schema_version: 1
  run_id: string
  state: 'prepared' | 'applying' | 'rollback-failed'
  records: TransactionFileRecord[]
}

export interface ApplyTransactionOptions {
  runId?: string
  onWrite?: (path: string) => void | Promise<void>
  onRestore?: (path: string) => void | Promise<void>
}

function fail(message: string): never { throw new Error(`知识批次事务失败：${message}`) }
function hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex') }
function relativePosix(root: string, path: string): string { return relative(root, path).replaceAll('\\', '/') }
function isTargetPath(path: string): boolean { return path.startsWith('src/content/') || path.startsWith('src/data/routes/') || path.startsWith('public/media/') || path === 'generated/content-tombstones.json' }

function absolutePath(root: string, path: string): string {
  if (!isTargetPath(path)) fail(`操作路径不在可更新根目录：${path}`)
  const absolute = resolve(root, path)
  if (!absolute.startsWith(`${resolve(root)}${sep}`)) fail(`操作路径逃逸工作区：${path}`)
  return absolute
}

async function exists(path: string): Promise<boolean> { return Boolean(await lstat(path).catch(() => undefined)) }

function identityFromBytes(kind: KnowledgeBatchOperationV1['kind'], bytes: Buffer): { id: string; code?: string; domain?: string; course?: string } {
  if (kind === 'media') return { id: '' }
  if (kind === 'route') {
    const value = parse(bytes.toString('utf8')) as { id?: unknown; code?: unknown }
    if (typeof value?.id !== 'string' || typeof value.code !== 'string') fail('路线 ID 或 code 无效')
    return { id: value.id, code: value.code }
  }
  const value = parseFrontmatter(bytes.toString('utf8')).data as { id?: unknown; domain_id?: unknown; course_id?: unknown }
  if (typeof value.id !== 'string' || typeof value.domain_id !== 'string' || typeof value.course_id !== 'string') fail('节点 ID 或 taxonomy 无效')
  return { id: value.id, domain: value.domain_id, course: value.course_id }
}

function entityFromBytes(operation: KnowledgeBatchOperationV1, bytes: Buffer): { id: string; code?: string; domain?: string; course?: string } {
  const identity = identityFromBytes(operation.kind, bytes)
  if (operation.kind !== 'media' && identity.id !== operation.entity_id) fail(`${operation.operation_id} 的实体 ID 不匹配`)
  return identity
}

async function assertEntityAvailable(root: string, operation: KnowledgeBatchOperationV1): Promise<void> {
  if (operation.kind === 'media' || operation.move_from) return
  const directory = operation.kind === 'node' ? resolve(root, 'src/content') : resolve(root, 'src/data/routes')
  const paths = operation.kind === 'node' ? await findFiles(directory, '.md') : [...await findFiles(directory, '.yaml'), ...await findFiles(directory, '.yml')]
  for (const path of paths) if (relativePosix(root, path) !== operation.path && identityFromBytes(operation.kind, await readFile(path)).id === operation.entity_id) fail(`${operation.operation_id} 复用了现有实体 ID`)
}

interface NodeInfo { id: string; path: string; references: string[]; qa?: { chain_id: string; parent_node_id: string | null }; roaming: boolean }
interface DeletePlan { paths: string[]; tombstones: Partial<ContentTombstonesV1> }

async function sourceNodes(root: string): Promise<NodeInfo[]> {
  return Promise.all((await findFiles(resolve(root, 'src/content'), '.md')).map(async (path) => {
    const data = parseFrontmatter((await readFile(path)).toString('utf8')).data as { id: string; domain_id: string; course_id: string; prerequisites?: string[]; related?: string[]; qa?: { chain_id: string; parent_node_id: string | null } }
    return { id: data.id, path: relativePosix(root, path), references: [...(data.prerequisites ?? []), ...(data.related ?? [])], qa: data.qa, roaming: data.domain_id === 'knowledge-roaming' && data.course_id === 'knowledge-roaming-pool' }
  }))
}

function containsRouteNode(value: unknown, nodeId: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsRouteNode(entry, nodeId))
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, entry]) => key === 'node_id' ? entry === nodeId : containsRouteNode(entry, nodeId))
}

async function hasFormalReference(root: string, nodes: NodeInfo[], target: NodeInfo): Promise<boolean> {
  if (nodes.some((node) => node.id !== target.id && node.references.includes(target.id))) return true
  const routes = [...await findFiles(resolve(root, 'src/data/routes'), '.yaml'), ...await findFiles(resolve(root, 'src/data/routes'), '.yml')]
  return (await Promise.all(routes.map(async (path) => containsRouteNode(parse((await readFile(path)).toString('utf8')), target.id)))).some(Boolean)
}

async function deletionPlan(root: string, operation: KnowledgeBatchOperationV1): Promise<DeletePlan> {
  if (operation.kind === 'route') fail('路线删除需要明确的产品决策')
  const target = absolutePath(root, operation.path)
  if (!await exists(target) || !operation.expected_previous_sha256 || hash(await readFile(target)) !== operation.expected_previous_sha256) fail(`${operation.operation_id} 的前置内容哈希不匹配`)
  if (operation.kind === 'media') return { paths: [operation.path], tombstones: {} }
  const nodes = await sourceNodes(root); const current = nodes.find((node) => node.path === operation.path)
  if (!current || current.id !== operation.entity_id) fail(`${operation.operation_id} 的节点实体不匹配`)
  if (operation.delete_mode === 'single-node') {
    if (current.qa || current.roaming) fail(`${operation.operation_id} 不能以 single-node 删除 QA 或 roaming 节点`)
    if (await hasFormalReference(root, nodes, current)) fail(`${operation.operation_id} 的节点仍被正式内容引用`)
    return { paths: [current.path], tombstones: { node_ids: [current.id] } }
  }
  if (operation.delete_mode === 'roaming-node') {
    if (!current.roaming) fail(`${operation.operation_id} 不是 frozen roaming 节点`)
    const sequence = /^(\d{4})-/.exec(basename(current.path))?.[1]
    if (!sequence) fail(`${operation.operation_id} 缺少四位 roaming 序号`)
    return { paths: [current.path], tombstones: { node_ids: [current.id], roaming_sequences: [sequence] } }
  }
  if (!current.qa || !operation.chain_id || current.qa.chain_id !== operation.chain_id) fail(`${operation.operation_id} 的 QA chain 不匹配`)
  const chain = nodes.filter((node) => node.qa?.chain_id === operation.chain_id)
  if (operation.delete_mode === 'qa-chain') return { paths: chain.map((node) => node.path), tombstones: { node_ids: chain.map((node) => node.id), qa_chain_ids: [operation.chain_id], qa_sequences: chain.map((node) => node.id.replace(/^qa-/, '')) } }
  if (operation.delete_mode !== 'qa-descendants' || !operation.from_node_id || !operation.expected_descendant_ids) fail(`${operation.operation_id} 的 QA 删除参数无效`)
  const descendants: NodeInfo[] = []; let parent = operation.from_node_id
  while (true) { const child = chain.find((node) => node.qa?.parent_node_id === parent); if (!child) break; descendants.push(child); parent = child.id }
  if (descendants.map((node) => node.id).join('\0') !== operation.expected_descendant_ids.join('\0')) fail(`${operation.operation_id} 的 QA 后继列表不匹配`)
  return { paths: descendants.map((node) => node.path), tombstones: { node_ids: descendants.map((node) => node.id), qa_sequences: descendants.map((node) => node.id.replace(/^qa-/, '')) } }
}

async function assertOperationPreconditions(root: string, batch: ScannedBatch): Promise<void> {
  if (!batch.staging_path) fail(`批次 ${batch.manifest.batch_id} 没有受控暂存内容`)
  for (const operation of batch.manifest.operations) {
    if (operation.action === 'delete') fail(`${operation.operation_id} 的删除操作必须由删除阶段处理`)
    const target = absolutePath(root, operation.path)
    const source = operation.move_from ? absolutePath(root, operation.move_from) : undefined
    const targetExists = await exists(target)
    const sameCasePath = Boolean(source && source.toLocaleLowerCase('en-US') === target.toLocaleLowerCase('en-US'))
    if (operation.action === 'add') {
      if (targetExists && !sameCasePath) fail(`${operation.operation_id} 的目标已经存在`)
      if (source) {
        if (!await exists(source)) fail(`${operation.operation_id} 的 move_from 不存在`)
        if (!operation.expected_previous_sha256 || hash(await readFile(source)) !== operation.expected_previous_sha256) fail(`${operation.operation_id} 的 move_from 哈希不匹配`)
        entityFromBytes(operation, await readFile(source))
      } else {
        const payload = resolve(batch.staging_path, operation.path)
        if (!await exists(payload)) fail(`${operation.operation_id} 缺少 payload`)
        entityFromBytes(operation, await readFile(payload))
        await assertEntityAvailable(root, operation)
      }
    } else {
      if (!targetExists) fail(`${operation.operation_id} 的目标不存在`)
      if (!operation.expected_previous_sha256 || hash(await readFile(target)) !== operation.expected_previous_sha256) fail(`${operation.operation_id} 的前置内容哈希不匹配`)
      const before = entityFromBytes(operation, await readFile(target))
      const payload = resolve(batch.staging_path, operation.path)
      if (!await exists(payload)) fail(`${operation.operation_id} 缺少 payload`)
      const after = entityFromBytes(operation, await readFile(payload))
      if (before.id !== after.id || before.code !== after.code || before.domain !== after.domain || before.course !== after.course) fail(`${operation.operation_id} 不能修改永久实体标识或 taxonomy`)
    }
  }
}

async function writeJournal(path: string, journal: KnowledgeTransactionJournal): Promise<void> {
  await writeFile(path, `${JSON.stringify(journal, null, 2)}\n`, 'utf8')
}

async function snapshot(root: string, transactionRoot: string, paths: string[]): Promise<TransactionFileRecord[]> {
  const records: TransactionFileRecord[] = []
  for (const [index, path] of paths.entries()) {
    const absolute = absolutePath(root, path)
    if (!await exists(absolute)) { records.push({ path, existed: false, applied: false, restored: false }); continue }
    const backup = `backup/${index}`
    await mkdir(resolve(transactionRoot, 'backup'), { recursive: true })
    await copyFile(absolute, resolve(transactionRoot, backup))
    records.push({ path, existed: true, sha256: hash(await readFile(absolute)), backup, applied: false, restored: false })
  }
  return records
}

async function restore(root: string, transactionRoot: string, journalPath: string, journal: KnowledgeTransactionJournal, onRestore?: ApplyTransactionOptions['onRestore']): Promise<void> {
  try {
    for (const record of [...journal.records].reverse()) {
      const target = absolutePath(root, record.path)
      if (record.existed) {
        await mkdir(dirname(target), { recursive: true })
        await copyFile(resolve(transactionRoot, record.backup!), target)
      } else await rm(target, { force: true })
      record.restored = true
      await onRestore?.(record.path)
      await writeJournal(journalPath, journal)
    }
    await rm(transactionRoot, { recursive: true, force: true })
  } catch (error) {
    journal.state = 'rollback-failed'
    await writeJournal(journalPath, journal)
    throw new Error('知识批次事务回滚失败；已保留 journal 与 backup。', { cause: error })
  }
}

export async function applyBatchTransaction(root: string, batch: ScannedBatch, options: ApplyTransactionOptions = {}): Promise<void> {
  const workspace = resolve(root); const runId = options.runId ?? randomUUID()
  const tombstonePath = 'generated/content-tombstones.json'
  const currentTombstones = await readTombstones(resolve(workspace, tombstonePath))
  for (const operation of batch.manifest.operations) if (operation.action === 'add' && operation.kind === 'node' && currentTombstones.node_ids.includes(operation.entity_id)) fail(`${operation.operation_id} 复用了 tombstoned 节点 ID`)
  await assertOperationPreconditions(workspace, { ...batch, manifest: { ...batch.manifest, operations: batch.manifest.operations.filter((operation) => operation.action !== 'delete') } })
  const deletePlans = new Map<string, DeletePlan>()
  for (const operation of batch.manifest.operations.filter((operation) => operation.action === 'delete')) deletePlans.set(operation.operation_id, await deletionPlan(workspace, operation))
  const transactionRoot = resolve(workspace, '.tmp', 'knowledge-import', runId, 'transaction')
  const journalPath = resolve(transactionRoot, 'journal.json')
  const paths = [...new Set([...batch.manifest.operations.flatMap((operation) => operation.action === 'delete' ? deletePlans.get(operation.operation_id)!.paths : operation.move_from ? [operation.path, operation.move_from] : [operation.path]), ...(deletePlans.size ? [tombstonePath] : [])])]
  const journal: KnowledgeTransactionJournal = { schema_version: 1, run_id: runId, state: 'prepared', records: await snapshot(workspace, transactionRoot, paths) }
  await mkdir(resolve(transactionRoot, 'staged'), { recursive: true })
  await writeJournal(journalPath, journal)
  try {
    journal.state = 'applying'; await writeJournal(journalPath, journal)
    for (const operation of batch.manifest.operations) {
      const target = absolutePath(workspace, operation.path)
      if (operation.action === 'delete') {
        for (const path of deletePlans.get(operation.operation_id)!.paths) await rm(absolutePath(workspace, path))
        for (const record of journal.records) if (deletePlans.get(operation.operation_id)!.paths.includes(record.path)) record.applied = true
        await writeJournal(journalPath, journal); await options.onWrite?.(operation.path)
        continue
      }
      const staged = resolve(transactionRoot, 'staged', operation.operation_id)
      if (operation.action === 'replace' || !operation.move_from) await copyFile(resolve(batch.staging_path!, operation.path), staged)
      if (operation.move_from) {
        const source = absolutePath(workspace, operation.move_from)
        await mkdir(dirname(target), { recursive: true })
        if (source.toLocaleLowerCase('en-US') === target.toLocaleLowerCase('en-US')) {
          const intermediate = `${source}.move-${runId}`
          await rename(source, intermediate); await rename(intermediate, target)
        } else { await copyFile(source, target); await rm(source) }
      } else {
        await mkdir(dirname(target), { recursive: true })
        await copyFile(staged, target)
      }
      for (const record of journal.records) if (record.path === operation.path || record.path === operation.move_from) record.applied = true
      await writeJournal(journalPath, journal)
      await options.onWrite?.(operation.path)
    }
    if (deletePlans.size) {
      const additions = [...deletePlans.values()].reduce<Partial<ContentTombstonesV1>>((result, plan) => ({ node_ids: [...(result.node_ids ?? []), ...(plan.tombstones.node_ids ?? [])], qa_chain_ids: [...(result.qa_chain_ids ?? []), ...(plan.tombstones.qa_chain_ids ?? [])], roaming_sequences: [...(result.roaming_sequences ?? []), ...(plan.tombstones.roaming_sequences ?? [])], qa_sequences: [...(result.qa_sequences ?? []), ...(plan.tombstones.qa_sequences ?? [])] }), {})
      await writeTombstones(resolve(workspace, tombstonePath), extendTombstones(currentTombstones, additions))
      const record = journal.records.find((entry) => entry.path === tombstonePath); if (record) record.applied = true
      await writeJournal(journalPath, journal)
    }
    await rm(transactionRoot, { recursive: true, force: true })
  } catch (error) {
    await restore(workspace, transactionRoot, journalPath, journal, options.onRestore)
    throw error
  }
}

export async function transactionJournalPath(root: string, runId: string): Promise<string | undefined> {
  const path = resolve(root, '.tmp', 'knowledge-import', runId, 'transaction', 'journal.json')
  return await exists(path) ? relativePosix(root, path) : undefined
}
