import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { parse, stringify } from 'yaml'
import { createContentWorkspace } from '../content/config'
import { renderKnowledgeMap } from '../content/build-knowledge-map'
import { validateSource } from '../content/validate-source'
import { scanKnowledgeBatch, type ScannedBatch } from './scan-batch'
import { applyBatchTransaction } from './transaction'

const execFileAsync = promisify(execFile)
const SOURCE_TREES = ['src/content', 'src/data/taxonomy', 'src/data/routes', 'src/data/changelog', 'public/media'] as const
const INDEX_PATH = 'generated/imported-batches.json'
const TOMBSTONE_PATH = 'generated/content-tombstones.json'

export interface ImportedBatchRecordV1 {
  batch_id: string
  zip_sha256: string
  base_content_version: string
  target_content_version: string
  released_on: string
  applied_at: string
  operation_counts: Record<string, number>
}

export interface ImportedBatchIndexV1 {
  schema_version: 1
  batches: ImportedBatchRecordV1[]
}

export interface DryRunReport {
  schema_version: 1
  mode: 'dry-run'
  run_id: string
  git: { head: string; clean: boolean }
  current_content_version: string
  target_content_version: string
  ordered_batch_ids: string[]
  batches: Array<{ batch_id: string; zip_path: string; zip_sha256: string; released_on: string; base_content_version: string; target_content_version: string; operation_counts: Record<string, number> }>
  source_tree_fingerprint: string
  result_tree_fingerprint: string
  knowledge_map_fingerprint: string
  confirmation_token: string
  commands: Array<{ command: string; status: 'passed' }>
  warnings: string[]
  conclusion: 'dry-run 未修改正式源'
}

export interface DryRunOptions {
  repositoryRoot?: string
  runId?: string
  git?: { head: string; clean: boolean }
}

function sha256(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex') }

function fail(message: string): never { throw new Error(`知识批次 dry-run 失败：${message}`) }

function relativePosix(root: string, path: string): string { return relative(root, path).replaceAll('\\', '/') }

async function gitState(root: string): Promise<{ head: string; clean: boolean }> {
  const [head, status] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
    execFileAsync('git', ['status', '--porcelain'], { cwd: root }),
  ])
  return { head: head.stdout.trim(), clean: status.stdout.trim().length === 0 }
}

async function filesInTree(root: string, directory: string): Promise<string[]> {
  const absolute = resolve(root, directory)
  const metadata = await lstat(absolute).catch(() => undefined)
  if (!metadata) return []
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) fail(`源树不是普通目录：${directory}`)
  const paths: string[] = []
  for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const childRelative = `${directory}/${entry.name}`
    if (entry.isSymbolicLink()) fail(`源树包含符号链接：${childRelative}`)
    if (entry.isDirectory()) paths.push(...await filesInTree(root, childRelative))
    else if (entry.isFile()) paths.push(childRelative.replaceAll('\\', '/'))
    else fail(`源树包含非普通文件：${childRelative}`)
  }
  return paths
}

async function sourceFiles(root: string): Promise<string[]> {
  const files = (await Promise.all(SOURCE_TREES.map((directory) => filesInTree(root, directory)))).flat()
  for (const path of [INDEX_PATH, TOMBSTONE_PATH]) if ((await lstat(resolve(root, path)).catch(() => undefined))?.isFile()) files.push(path)
  return files.sort((a, b) => a.localeCompare(b, 'en'))
}

async function treeFingerprint(root: string): Promise<string> {
  const digest = createHash('sha256')
  for (const path of await sourceFiles(root)) {
    digest.update(path).update('\0').update(await readFile(resolve(root, path))).update('\0')
  }
  return digest.digest('hex')
}

async function copyTree(sourceRoot: string, targetRoot: string, directory: string): Promise<void> {
  const source = resolve(sourceRoot, directory)
  const target = resolve(targetRoot, directory)
  const metadata = await lstat(source)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) fail(`无法复制非普通目录：${directory}`)
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name)
    const targetPath = resolve(target, entry.name)
    if (entry.isSymbolicLink()) fail(`无法复制符号链接：${relativePosix(sourceRoot, sourcePath)}`)
    if (entry.isDirectory()) await copyTree(sourceRoot, targetRoot, `${directory}/${entry.name}`)
    else if (entry.isFile()) {
      await mkdir(dirname(targetPath), { recursive: true })
      await copyFile(sourcePath, targetPath, 0)
    } else fail(`无法复制非普通文件：${relativePosix(sourceRoot, sourcePath)}`)
  }
}

function operationCounts(batch: ScannedBatch): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const operation of batch.manifest.operations) {
    const key = `${operation.action}:${operation.kind}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

async function applyOperations(workspaceRoot: string, batch: ScannedBatch): Promise<void> {
  await applyBatchTransaction(workspaceRoot, batch)
}

function parseIndex(value: unknown): ImportedBatchIndexV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('已导入批次索引不是对象')
  const index = value as Partial<ImportedBatchIndexV1>
  if (index.schema_version !== 1 || !Array.isArray(index.batches)) fail('已导入批次索引版本无效')
  const ids = new Set<string>(); const targets = new Set<string>()
  for (const batch of index.batches) {
    if (!batch || typeof batch !== 'object' || typeof batch.batch_id !== 'string' || typeof batch.zip_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(batch.zip_sha256) || typeof batch.base_content_version !== 'string' || typeof batch.target_content_version !== 'string' || typeof batch.released_on !== 'string' || typeof batch.applied_at !== 'string' || !batch.operation_counts || typeof batch.operation_counts !== 'object' || Array.isArray(batch.operation_counts)) fail('已导入批次索引条目无效')
    if (ids.has(batch.batch_id) || targets.has(batch.target_content_version)) fail('已导入批次索引存在重复 batch_id 或目标版本')
    if (Object.values(batch.operation_counts).some((count) => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) fail('已导入批次索引的操作统计无效')
    ids.add(batch.batch_id); targets.add(batch.target_content_version)
  }
  return index as ImportedBatchIndexV1
}

export async function readImportedBatchIndex(root = process.cwd()): Promise<ImportedBatchIndexV1> {
  const path = resolve(root, INDEX_PATH)
  const source = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? '{"schema_version":1,"batches":[]}' : Promise.reject(error))
  try { return parseIndex(JSON.parse(source)) } catch (error) { if (error instanceof Error && error.message.startsWith('知识批次')) throw error; fail('已导入批次索引不是有效 JSON') }
}

async function currentVersion(root: string): Promise<string> {
  const source = await readFile(resolve(root, 'src/data/changelog/knowledge.yaml'), 'utf8')
  const value = parse(source) as { current_version?: unknown }
  if (typeof value?.current_version !== 'string' || !value.current_version) fail('知识版本日志缺少 current_version')
  return value.current_version
}

async function assertVersionArtifacts(root: string, version: string): Promise<void> {
  const map = await readFile(resolve(root, 'generated/knowledge-map.md'), 'utf8')
  if (!map.includes(`知识版本：${version}`)) fail('知识地图版本与知识日志不一致')
  for (const name of ['catalog.json', 'knowledge-changelog.json'] as const) {
    const value = JSON.parse(await readFile(resolve(root, 'public/_generated', name), 'utf8')) as { content_version?: unknown; current_version?: unknown }
    const artifactVersion = value.content_version ?? value.current_version
    if (artifactVersion !== version) fail(`${name} 版本与知识日志不一致`)
  }
}

function orderBatches(batches: ScannedBatch[], current: string): ScannedBatch[] {
  const remaining = new Map(batches.map((batch) => [batch.manifest.batch_id, batch]))
  const ordered: ScannedBatch[] = []; let version = current; let priorDate = ''
  while (remaining.size) {
    const next = [...remaining.values()].filter((batch) => batch.manifest.base_content_version === version)
    if (next.length !== 1) fail(next.length === 0 ? `没有从版本 ${version} 连续衔接的批次` : `版本 ${version} 存在多个后继批次`)
    const batch = next[0]
    if (batch.manifest.target_content_version === version) fail(`批次 ${batch.manifest.batch_id} 的目标版本没有推进`)
    if (priorDate && batch.manifest.released_on < priorDate) fail(`批次 ${batch.manifest.batch_id} 的 released_on 倒退`)
    ordered.push(batch); remaining.delete(batch.manifest.batch_id); version = batch.manifest.target_content_version; priorDate = batch.manifest.released_on
  }
  return ordered
}

function addTemporaryChangelog(root: string, batch: ScannedBatch): Promise<void> {
  const path = resolve(root, 'src/data/changelog/knowledge.yaml')
  return readFile(path, 'utf8').then(async (source) => {
    const log = parse(source) as { current_version: string; entries: Array<Record<string, unknown>> }
    log.current_version = batch.manifest.target_content_version
    log.entries.unshift({ version: batch.manifest.target_content_version, date: batch.manifest.released_on, summary: batch.manifest.summary, categories: [...new Set(batch.manifest.operations.map((operation) => operation.kind))].sort(), added_nodes: batch.manifest.operations.filter((operation) => operation.kind === 'node' && operation.action === 'add').map((operation) => operation.entity_id), modified_nodes: batch.manifest.operations.filter((operation) => operation.kind === 'node' && operation.action === 'replace').map((operation) => operation.entity_id), deleted_nodes: batch.manifest.operations.filter((operation) => operation.kind === 'node' && operation.action === 'delete').map((operation) => operation.entity_id) })
    await writeFile(path, stringify(log), 'utf8')
  })
}

async function updateTemporaryIndex(root: string, batches: ScannedBatch[]): Promise<void> {
  const index = await readImportedBatchIndex(root)
  index.batches.push(...batches.map((batch) => ({
    batch_id: batch.manifest.batch_id,
    zip_sha256: batch.zip_sha256,
    base_content_version: batch.manifest.base_content_version,
    target_content_version: batch.manifest.target_content_version,
    released_on: batch.manifest.released_on,
    // A dry-run needs a stable, inspectable candidate tree; Phase 5 will use the real apply time.
    applied_at: batch.manifest.created_at,
    operation_counts: operationCounts(batch),
  })))
  await writeFile(resolve(root, INDEX_PATH), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}

async function writeReports(root: string, report: DryRunReport): Promise<void> {
  const reports = resolve(root, 'inbox/reports')
  await mkdir(reports, { recursive: true })
  const basename = `${report.run_id}-dry-run`
  await writeFile(resolve(reports, `${basename}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  const lines = ['# 知识批次 dry-run', '', `- HEAD: ${report.git.head}`, `- 工作区干净: ${report.git.clean ? '是' : '否'}`, `- 版本: ${report.current_content_version} → ${report.target_content_version}`, `- 批次: ${report.ordered_batch_ids.join(', ')}`, `- 源树指纹: ${report.source_tree_fingerprint}`, `- 结果树指纹: ${report.result_tree_fingerprint}`, `- 确认令牌: ${report.confirmation_token}`, '', 'dry-run 未修改正式源。']
  await writeFile(resolve(reports, `${basename}.md`), `${lines.join('\n')}\n`, 'utf8')
}

export async function dryRunKnowledgeUpdate(options: DryRunOptions = {}): Promise<DryRunReport | undefined> {
  const root = resolve(options.repositoryRoot ?? process.cwd())
  const runId = options.runId ?? randomUUID()
  const inbox = resolve(root, 'inbox/batches')
  const candidates = (await readdir(inbox, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error)))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip')).map((entry) => resolve(inbox, entry.name)).sort((a, b) => a.localeCompare(b, 'en'))
  if (candidates.length === 0) return undefined
  const index = await readImportedBatchIndex(root)
  const scanned = await Promise.all(candidates.map((path) => scanKnowledgeBatch(path, { repositoryRoot: root, retainStaging: true })))
  try {
    const seen = new Set<string>()
    for (const batch of scanned) {
      if (seen.has(batch.manifest.batch_id)) fail(`收件箱含有重复 batch_id：${batch.manifest.batch_id}`)
      seen.add(batch.manifest.batch_id)
    }
    const imported = new Map(index.batches.map((batch) => [batch.batch_id, batch]))
    const pending = scanned.filter((batch) => {
      const prior = imported.get(batch.manifest.batch_id)
      if (!prior) return true
      if (prior.zip_sha256 !== batch.zip_sha256) fail(`已导入批次 ${batch.manifest.batch_id} 的 ZIP 哈希冲突`)
      return false
    })
    if (pending.length === 0) return undefined
    const current = await currentVersion(root)
    if (index.batches.length && index.batches.at(-1)?.target_content_version !== current) fail('已导入批次历史尾部与当前知识版本不一致')
    await assertVersionArtifacts(root, current)
    const ordered = orderBatches(pending, current)
    const sourceFingerprint = await treeFingerprint(root)
    const tempRoot = resolve(root, '.tmp', 'knowledge-dry-run', runId)
    try {
      for (const directory of SOURCE_TREES) await copyTree(root, tempRoot, directory)
      await mkdir(resolve(tempRoot, 'generated'), { recursive: true })
      for (const path of [INDEX_PATH, TOMBSTONE_PATH]) if (await lstat(resolve(root, path)).catch(() => undefined)) await copyFile(resolve(root, path), resolve(tempRoot, path))
      for (const batch of ordered) { await applyOperations(tempRoot, batch); await addTemporaryChangelog(tempRoot, batch) }
      await updateTemporaryIndex(tempRoot, ordered)
      const validation = await validateSource(createContentWorkspace(tempRoot, resolve(root, 'schemas')))
      const errors = validation.issues.filter((issue) => issue.severity === 'error')
      if (errors.length) fail(`临时内容验证失败：${errors.map((issue) => issue.code).join(', ')}`)
      const target = ordered.at(-1)!.manifest.target_content_version
      const map = renderKnowledgeMap(validation, target)
      const git = options.git ?? await gitState(root)
      const report: DryRunReport = { schema_version: 1, mode: 'dry-run', run_id: runId, git, current_content_version: current, target_content_version: target, ordered_batch_ids: ordered.map((batch) => batch.manifest.batch_id), batches: ordered.map((batch) => ({ batch_id: batch.manifest.batch_id, zip_path: batch.zip_path, zip_sha256: batch.zip_sha256, released_on: batch.manifest.released_on, base_content_version: batch.manifest.base_content_version, target_content_version: batch.manifest.target_content_version, operation_counts: operationCounts(batch) })), source_tree_fingerprint: sourceFingerprint, result_tree_fingerprint: await treeFingerprint(tempRoot), knowledge_map_fingerprint: sha256(map), confirmation_token: `APPLY:${ordered.length}:${target}:${sourceFingerprint.slice(0, 12)}`, commands: [{ command: 'content:validate (temporary workspace)', status: 'passed' }, { command: 'content:map (temporary workspace)', status: 'passed' }], warnings: git.clean ? [] : ['工作区存在未提交改动；本次只生成 dry-run 报告。'], conclusion: 'dry-run 未修改正式源' }
      await writeReports(root, report)
      return report
    } finally { await rm(tempRoot, { recursive: true, force: true }) }
  } finally {
    await Promise.all(scanned.map((batch) => batch.staging_path ? rm(resolve(batch.staging_path, '..', '..'), { recursive: true, force: true }) : undefined))
  }
}
