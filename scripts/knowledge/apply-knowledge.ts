import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { buildAllContent } from '../content/build-all'
import { renderKnowledgeMap } from '../content/build-knowledge-map'
import { createContentWorkspace } from '../content/config'
import { validateSource } from '../content/validate-source'
import { dryRunKnowledgeUpdate, readImportedBatchIndex } from './dry-run'
import { scanKnowledgeBatch, type ScannedBatch } from './scan-batch'
import { applyBatchTransaction } from './transaction'

const SNAPSHOT_PATHS = ['src/content', 'src/data/routes', 'public/media', 'src/data/changelog/knowledge.yaml', 'generated/imported-batches.json', 'generated/content-tombstones.json', 'generated/knowledge-map.md'] as const
function hash(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
function fail(message: string): never { throw new Error(`知识批次 apply 失败：${message}`) }

export interface ApplyKnowledgeOptions { repositoryRoot?: string; confirmationToken: string; git?: { head: string; clean: boolean }; onPoint?: (point: 'operations' | 'metadata') => void | Promise<void> }
export interface ApplyKnowledgeResult { applied: string[]; targetVersion: string; archiveWarning?: string }

async function exists(path: string): Promise<boolean> { return Boolean(await lstat(path).catch(() => undefined)) }
async function copyIntoBackup(root: string, backup: string, path: string): Promise<void> { if (await exists(resolve(root, path))) await cp(resolve(root, path), resolve(backup, path), { recursive: true }) }
async function restoreBackup(root: string, backup: string): Promise<void> {
  for (const path of SNAPSHOT_PATHS) await rm(resolve(root, path), { recursive: true, force: true })
  for (const path of SNAPSHOT_PATHS) if (await exists(resolve(backup, path))) await cp(resolve(backup, path), resolve(root, path), { recursive: true })
}

function counts(batch: ScannedBatch): Record<string, number> { return batch.manifest.operations.reduce<Record<string, number>>((result, operation) => ({ ...result, [`${operation.action}:${operation.kind}`]: (result[`${operation.action}:${operation.kind}`] ?? 0) + 1 }), {}) }

async function appendMetadata(root: string, batches: ScannedBatch[]): Promise<void> {
  const changelogPath = resolve(root, 'src/data/changelog/knowledge.yaml')
  const log = parse(await readFile(changelogPath, 'utf8')) as { current_version: string; entries: Array<Record<string, unknown>> }
  const index = await readImportedBatchIndex(root)
  for (const batch of batches) {
    log.current_version = batch.manifest.target_content_version
    log.entries.unshift({ version: batch.manifest.target_content_version, date: batch.manifest.released_on, summary: batch.manifest.summary, categories: [...new Set(batch.manifest.operations.map((operation) => operation.kind))].sort(), added_nodes: batch.manifest.operations.filter((operation) => operation.kind === 'node' && operation.action === 'add').map((operation) => operation.entity_id), modified_nodes: batch.manifest.operations.filter((operation) => operation.kind === 'node' && operation.action === 'replace').map((operation) => operation.entity_id), deleted_nodes: batch.manifest.operations.filter((operation) => operation.kind === 'node' && operation.action === 'delete').map((operation) => operation.entity_id) })
    index.batches.push({ batch_id: batch.manifest.batch_id, zip_sha256: batch.zip_sha256, base_content_version: batch.manifest.base_content_version, target_content_version: batch.manifest.target_content_version, released_on: batch.manifest.released_on, applied_at: new Date().toISOString(), operation_counts: counts(batch) })
  }
  await writeFile(changelogPath, stringify(log), 'utf8')
  await writeFile(resolve(root, 'generated/imported-batches.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}

async function archive(root: string, batches: ScannedBatch[]): Promise<string | undefined> {
  try {
    const processed = resolve(root, 'inbox/processed'); await mkdir(processed, { recursive: true })
    for (const batch of batches) {
      const source = resolve(root, batch.zip_path); const target = resolve(processed, basename(source))
      if (await exists(target)) throw new Error(`归档目标已存在：${basename(target)}`)
      await cp(source, target)
      if (hash(await readFile(target)) !== batch.zip_sha256) throw new Error(`归档 ZIP 哈希不匹配：${basename(target)}`)
      await rm(source)
    }
  } catch (error) { return error instanceof Error ? error.message : 'ZIP 归档失败' }
}

export async function applyKnowledgeUpdate(options: ApplyKnowledgeOptions): Promise<ApplyKnowledgeResult> {
  const root = resolve(options.repositoryRoot ?? process.cwd())
  const preview = await dryRunKnowledgeUpdate({ repositoryRoot: root, git: options.git })
  if (!preview) fail('没有待处理批次')
  if (preview.confirmation_token !== options.confirmationToken) fail('确认令牌已过期或不匹配')
  const lock = resolve(root, '.tmp/knowledge-import/update.lock'); if (await exists(lock)) fail('已有知识更新 lock；请先 recover 对应 journal')
  const runId = randomUUID(); const backup = resolve(root, '.tmp/knowledge-import', runId, 'apply-backup')
  await mkdir(backup, { recursive: true }); await writeFile(lock, `${runId}\n`, { flag: 'wx' })
  const candidates = (await readdir(resolve(root, 'inbox/batches'), { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip')).map((entry) => resolve(root, 'inbox/batches', entry.name))
  const scanned = await Promise.all(candidates.map((path) => scanKnowledgeBatch(path, { repositoryRoot: root, retainStaging: true })))
  const ordered = preview.ordered_batch_ids.map((id) => scanned.find((batch) => batch.manifest.batch_id === id) ?? fail(`批次 ${id} 在重新扫描时缺失`))
  try {
    for (const path of SNAPSHOT_PATHS) await copyIntoBackup(root, backup, path)
    for (const batch of ordered) await applyBatchTransaction(root, batch, { runId: `${runId}-${batch.manifest.batch_id}` })
    await options.onPoint?.('operations')
    await appendMetadata(root, ordered)
    const validation = await validateSource(createContentWorkspace(root, resolve(root, 'schemas')))
    const errors = validation.issues.filter((issue) => issue.severity === 'error'); if (errors.length) fail(`内容验证失败：${errors.map((issue) => issue.code).join(', ')}`)
    await writeFile(resolve(root, 'generated/knowledge-map.md'), renderKnowledgeMap(validation, ordered.at(-1)!.manifest.target_content_version), 'utf8')
    await options.onPoint?.('metadata')
    await buildAllContent({ workspace: createContentWorkspace(root, resolve(root, 'schemas')), targetRoot: resolve(root, 'public/_generated'), publicDirectory: resolve(root, 'public') })
    const archiveWarning = await archive(root, ordered)
    await rm(backup, { recursive: true, force: true })
    return { applied: ordered.map((batch) => batch.manifest.batch_id), targetVersion: ordered.at(-1)!.manifest.target_content_version, archiveWarning }
  } catch (error) {
    try { await restoreBackup(root, backup) } catch (restoreError) { throw new AggregateError([error, restoreError], '知识更新失败且外层恢复失败；已保留 backup。', { cause: restoreError }) }
    throw error
  } finally {
    await rm(lock, { force: true })
    await Promise.all(scanned.map((batch) => batch.staging_path ? rm(resolve(batch.staging_path, '..', '..'), { recursive: true, force: true }) : undefined))
  }
}
