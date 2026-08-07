import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { ALLOWED_MEDIA_EXTENSIONS, BATCH_ID_PATTERN, validateBatchPath, validateKnowledgeBatch, type KnowledgeBatchOperationV1, type KnowledgeBatchV1 } from '../../src/import/knowledge-batch'
import { parseFrontmatter } from '../content/parse-frontmatter'
import { dryRunKnowledgeUpdate, readImportedBatchIndex, type DryRunOptions } from '../knowledge/dry-run'
import { authoringPath, fail, hash, posixRelative, regularFiles } from './common'

interface BatchOptions { repositoryRoot?: string; source: string; batchId: string; targetVersion: string; releasedOn: string; summary: string; git?: DryRunOptions['git'] }
export interface BatchResult { zipPath: string; manifest: KnowledgeBatchV1; confirmationToken: string }

interface Payload { path: string; bytes: Buffer; kind: 'node' | 'route' | 'media'; entityId: string }

function args(): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]; const value = process.argv[index + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--')) fail('参数必须使用 --name value')
    result[key.slice(2)] = value
  }
  return result
}

async function currentVersion(root: string): Promise<string> {
  const value = parse(await readFile(resolve(root, 'src/data/changelog/knowledge.yaml'), 'utf8')) as { current_version?: unknown }
  if (typeof value?.current_version !== 'string' || !/^\d{4}\.\d{2}\.\d{2}-\d{2}$/.test(value.current_version)) fail('当前知识版本无效')
  return value.current_version
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
function u16(value: number): Buffer { const result = Buffer.alloc(2); result.writeUInt16LE(value); return result }
function u32(value: number): Buffer { const result = Buffer.alloc(4); result.writeUInt32LE(value); return result }
function storedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8'); const crc = crc32(entry.data); const flags = 0x0800
    const header = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), u16(20), u16(flags), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name, entry.data])
    local.push(header)
    central.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02]), u16(20), u16(20), u16(flags), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]))
    offset += header.length
  }
  const directory = Buffer.concat(central)
  return Buffer.concat([...local, directory, Buffer.from([0x50, 0x4b, 0x05, 0x06]), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)])
}

function identity(path: string, bytes: Buffer): Payload['kind'] extends never ? never : { kind: Payload['kind']; entityId: string } {
  if (path.startsWith('src/content/') && path.endsWith('.md')) {
    const id = parseFrontmatter(bytes.toString('utf8')).data.id
    if (typeof id !== 'string') fail(`节点缺少 id：${path}`)
    return { kind: 'node', entityId: id }
  }
  if (path.startsWith('src/data/routes/') && path.endsWith('.yaml') && !path.slice('src/data/routes/'.length).includes('/')) {
    const id = (parse(bytes.toString('utf8')) as { id?: unknown })?.id
    if (typeof id !== 'string') fail(`路线缺少 id：${path}`)
    return { kind: 'route', entityId: id }
  }
  if (path.startsWith('public/media/') && ALLOWED_MEDIA_EXTENSIONS.has(extname(path).toLowerCase())) return { kind: 'media', entityId: `media-${createHash('sha256').update(path).digest('hex').slice(0, 16)}` }
  fail(`不允许的 authoring 文件：${path}`)
}

async function payloads(workspace: string): Promise<Payload[]> {
  const result: Payload[] = []
  for (const file of await regularFiles(workspace)) {
    const path = posixRelative(workspace, file)
    if (path.startsWith('src/data/taxonomy/') || path.startsWith('generated/') || path.startsWith('schemas/')) fail(`authoring workspace 不允许包含：${path}`)
    const bytes = await readFile(file)
    const value = identity(path, bytes)
    if ((value.kind === 'node' || value.kind === 'route') && bytes.toString('utf8').includes('TODO')) fail(`不能发布含 TODO 的草稿：${path}`)
    if (!validateBatchPath(path)) fail(`不安全 authoring 路径：${path}`)
    result.push({ path, bytes, ...value })
  }
  if (!result.length) fail('authoring workspace 没有可发布文件')
  return result.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

async function targetInfo(root: string, payload: Payload): Promise<Pick<KnowledgeBatchOperationV1, 'action' | 'expected_previous_sha256'>> {
  const path = resolve(root, payload.path)
  const metadata = await lstat(path).catch(() => undefined)
  if (!metadata) return { action: 'add' }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`正式目标不是普通文件：${payload.path}`)
  return { action: 'replace', expected_previous_sha256: hash(await readFile(path)) }
}

export async function createBatch(options: BatchOptions): Promise<BatchResult> {
  const root = resolve(options.repositoryRoot ?? process.cwd())
  const workspace = authoringPath(root, options.source)
  if (!BATCH_ID_PATTERN.test(options.batchId)) fail('batch ID 格式无效')
  if (!/^\d{4}\.\d{2}\.\d{2}-\d{2}$/.test(options.targetVersion) || !/^\d{4}-\d{2}-\d{2}$/.test(options.releasedOn)) fail('target version 或 released-on 格式无效')
  const baseVersion = await currentVersion(root)
  if (options.targetVersion <= baseVersion) fail('target version 必须高于当前知识版本')
  if (!options.summary.trim()) fail('summary 不能为空')
  const pending = await readdir(resolve(root, 'inbox/batches'), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error))
  if (pending.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip'))) fail('inbox/batches 已有 pending ZIP；请先处理')
  const imported = await readImportedBatchIndex(root)
  if (imported.batches.some((entry) => entry.batch_id === options.batchId)) fail('batch ID 已经导入，不能复用')
  const files = await payloads(workspace)
  const operations = await Promise.all(files.map(async (payload, index) => {
    const target = await targetInfo(root, payload)
    return { operation_id: `op-${String(index + 1).padStart(4, '0')}`, ...target, kind: payload.kind, path: payload.path, entity_id: payload.entityId, payload_sha256: hash(payload.bytes) } as KnowledgeBatchOperationV1
  }))
  const manifest: KnowledgeBatchV1 = { schema_version: 1, batch_id: options.batchId, created_at: new Date().toISOString(), released_on: options.releasedOn, base_content_version: baseVersion, target_content_version: options.targetVersion, summary: options.summary.trim(), operations }
  if (!validateKnowledgeBatch(manifest)) fail('生成的 batch manifest 未通过现有 Schema')
  const zipPath = resolve(root, 'inbox/batches', `${options.batchId}.zip`)
  if (await lstat(zipPath).catch(() => undefined)) fail('目标 ZIP 已存在，拒绝覆盖')
  await mkdir(resolve(root, 'inbox/batches'), { recursive: true })
  await writeFile(zipPath, storedZip([{ name: 'batch.json', data: Buffer.from(JSON.stringify(manifest), 'utf8') }, ...files.map((file) => ({ name: `payload/${file.path}`, data: file.bytes }))]), { flag: 'wx' })
  try {
    const report = await dryRunKnowledgeUpdate({ repositoryRoot: root, git: options.git })
    if (!report) fail('ZIP 创建后 dry-run 没有发现批次')
    return { zipPath: posixRelative(root, zipPath), manifest, confirmationToken: report.confirmation_token }
  } catch (error) {
    await rm(zipPath, { force: true })
    throw error
  }
}

async function main(): Promise<void> {
  const values = args()
  const result = await createBatch({ source: values.source ?? '', batchId: values['batch-id'] ?? '', targetVersion: values['target-version'] ?? '', releasedOn: values['released-on'] ?? '', summary: values.summary ?? '' })
  console.log(`批次已创建\nZIP：${result.zipPath}\nbase：${result.manifest.base_content_version}\ntarget：${result.manifest.target_content_version}\noperations：${result.manifest.operations.length}\ndry-run：通过\n确认 token：${result.confirmationToken}\n下一步仍由用户显式执行 update-knowledge -- --apply ...`)
}

const isDirectExecution = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isDirectExecution) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
