/**
 * yauzl 3.4.0 was selected after checking its current maintenance and Node 24
 * support: it exposes lazy per-entry streams plus declared size/attributes,
 * has no native build, and never extracts a ZIP by itself.
 */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { once } from 'node:events'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { ALLOWED_MEDIA_EXTENSIONS, BATCH_ID_PATTERN, BATCH_LIMITS, knowledgeBatchValidationMessage, payloadPaths, validateBatchPath, validateKnowledgeBatch, type KnowledgeBatchV1 } from '../../src/import/knowledge-batch'

export interface ScannedEntry {
  zip_path: string
  path: string
  compressed_bytes: number
  declared_uncompressed_bytes: number
  actual_uncompressed_bytes: number
  sha256: string
}

export interface ScannedBatch {
  zip_path: string
  zip_sha256: string
  compressed_bytes: number
  declared_uncompressed_bytes: number
  actual_uncompressed_bytes: number
  entry_count: number
  manifest: KnowledgeBatchV1
  entries: ScannedEntry[]
  /** Present only for callers that explicitly retain the isolated extraction. */
  staging_path?: string
}

export interface ScanBatchOptions {
  repositoryRoot?: string
  retainStaging?: boolean
}

interface ZipEntry { entry: Entry; zipPath: string; path: string; directory: boolean }

function fail(message: string): never { throw new Error(`知识批次 ZIP 不安全：${message}`) }

async function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk: Buffer) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolveHash(hash.digest('hex')))
  })
}

function isSpecialEntry(entry: Entry): boolean {
  const creator = entry.versionMadeBy >>> 8
  if (creator !== 3) return false
  const type = (entry.externalFileAttributes >>> 16) & 0o170000
  return type !== 0 && type !== 0o100000 && type !== 0o40000
}

function validateZipPath(name: string): { path: string; directory: boolean } {
  const directory = name.endsWith('/')
  const raw = directory ? name.slice(0, -1) : name
  if (!raw || raw !== raw.normalize('NFC') || raw.includes('\\')) fail(`非法 ZIP 路径 ${JSON.stringify(name)}`)
  if (raw === 'batch.json') return { path: raw, directory }
  if (!raw.startsWith('payload/')) fail(`不允许的 ZIP 根路径 ${JSON.stringify(name)}`)
  const payload = raw.slice('payload/'.length)
  if (!payload && directory) return { path: raw, directory }
  if (!validateBatchPath(payload)) fail(`不安全 payload 路径 ${JSON.stringify(name)}`)
  return { path: payload, directory }
}

function validateMedia(path: string, bytes: Buffer): void {
  const extension = extname(path).toLowerCase()
  if (!ALLOWED_MEDIA_EXTENSIONS.has(extension)) fail(`不允许的媒体类型 ${path}`)
  const text = bytes.toString('utf8')
  if (extension === '.svg' && /<script\b|<foreignobject\b|\son[a-z]+\s*=|(?:https?:)?\/\//i.test(text)) fail(`危险 SVG ${path}`)
  const expected = extension === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === '.jpg' || extension === '.jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : extension === '.gif' ? /^GIF8[79]a/.test(text.slice(0, 6))
        : extension === '.webp' ? text.slice(0, 4) === 'RIFF' && text.slice(8, 12) === 'WEBP'
          : extension === '.avif' ? text.slice(4, 12).includes('ftyp') && text.includes('avif')
            : true
  if (!expected) fail(`媒体 magic bytes 不匹配 ${path}`)
}

async function openZip(path: string): Promise<ZipFile> {
  return yauzl.openPromise(path, { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: true, validateEntrySizes: true })
}

async function readEntry(zip: ZipFile, entry: Entry, limit: number): Promise<Buffer> {
  const stream = await zip.openReadStreamPromise(entry)
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk)
    total += bytes.byteLength
    if (total > limit) fail(`entry 超出读取限制 ${entry.fileName}`)
    chunks.push(bytes)
  }
  if (total !== entry.uncompressedSize) fail(`entry 声明大小与实际不一致 ${entry.fileName}`)
  return Buffer.concat(chunks)
}

async function extractEntry(zip: ZipFile, item: ZipEntry, stagingRoot: string): Promise<ScannedEntry> {
  const destination = resolve(stagingRoot, item.path)
  const rootWithSeparator = `${resolve(stagingRoot)}${sep}`
  if (!destination.startsWith(rootWithSeparator)) fail(`staging 路径逃逸 ${item.zipPath}`)
  await mkdir(dirname(destination), { recursive: true })
  const output = createWriteStream(destination, { flags: 'wx' })
  const hash = createHash('sha256')
  let actual = 0
  try {
    const stream = await zip.openReadStreamPromise(item.entry)
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk)
      actual += bytes.byteLength
      if (actual > BATCH_LIMITS.maxEntryBytes) fail(`单文件实际大小超限 ${item.zipPath}`)
      hash.update(bytes)
      if (!output.write(bytes)) await once(output, 'drain')
    }
    output.end()
    await once(output, 'finish')
  } catch (error) {
    output.destroy()
    throw error
  }
  if (actual !== item.entry.uncompressedSize) fail(`entry 声明大小与实际不一致 ${item.zipPath}`)
  return { zip_path: item.zipPath, path: item.path, compressed_bytes: item.entry.compressedSize, declared_uncompressed_bytes: item.entry.uncompressedSize, actual_uncompressed_bytes: actual, sha256: hash.digest('hex') }
}

export async function scanKnowledgeBatch(zipPath: string, options: ScanBatchOptions = {}): Promise<ScannedBatch> {
  const zipAbsolutePath = resolve(zipPath)
  const metadata = await stat(zipAbsolutePath)
  if (!metadata.isFile() || metadata.size > BATCH_LIMITS.maxZipBytes) fail('ZIP 文件不存在、不是普通文件或超过大小限制')
  const zip = await openZip(zipAbsolutePath)
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd())
  const runId = randomUUID()
  const stagingRunRoot = resolve(repositoryRoot, '.tmp', 'knowledge-import', runId)
  const stagingParent = resolve(repositoryRoot, '.tmp', 'knowledge-import')
  if (!stagingRunRoot.startsWith(`${stagingParent}${sep}`)) fail('staging root 非法')
  try {
    const entries: ZipEntry[] = []
    const seenRaw = new Set<string>()
    const seenInsensitive = new Set<string>()
    const filePaths = new Set<string>()
    const directoryPaths = new Set<string>()
    let declaredTotal = 0
    for await (const entry of zip.eachEntry()) {
      if (entries.length >= BATCH_LIMITS.maxEntries) fail('entry 数量超限')
      if (isSpecialEntry(entry)) fail(`不允许 symlink 或特殊文件 ${entry.fileName}`)
      if (entry.uncompressedSize > BATCH_LIMITS.maxEntryBytes) fail(`单文件声明大小超限 ${entry.fileName}`)
      if (entry.uncompressedSize > 0 && (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > BATCH_LIMITS.maxCompressionRatio)) fail(`压缩比超限 ${entry.fileName}`)
      declaredTotal += entry.uncompressedSize
      if (declaredTotal > BATCH_LIMITS.maxTotalBytes) fail('总声明解压大小超限')
      const { path, directory } = validateZipPath(entry.fileName)
      const key = entry.fileName.normalize('NFC').toLocaleLowerCase('en-US')
      if (seenRaw.has(entry.fileName) || seenInsensitive.has(key)) fail(`重复或大小写冲突 entry ${entry.fileName}`)
      seenRaw.add(entry.fileName); seenInsensitive.add(key)
      if (directory) directoryPaths.add(path)
      else filePaths.add(path)
      entries.push({ entry, zipPath: entry.fileName, path, directory })
    }
    for (const path of filePaths) if (directoryPaths.has(path)) fail(`目录与文件同名冲突 ${path}`)
    const manifests = entries.filter((item) => !item.directory && item.zipPath === 'batch.json')
    if (manifests.length !== 1) fail('batch.json 必须在 ZIP 根目录且恰好一个')
    const manifestBytes = await readEntry(zip, manifests[0].entry, BATCH_LIMITS.maxBatchManifestBytes)
    let manifestValue: unknown
    try { manifestValue = JSON.parse(manifestBytes.toString('utf8')) } catch { fail('batch.json 不是有效 JSON') }
    if (!validateKnowledgeBatch(manifestValue)) fail(knowledgeBatchValidationMessage())
    const manifest = manifestValue
    if (!BATCH_ID_PATTERN.test(manifest.batch_id) || basename(zipAbsolutePath) !== `${manifest.batch_id}.zip`) fail('ZIP 文件名与 batch_id 不一致')
    const operationIds = new Set<string>()
    for (const operation of manifest.operations) {
      if (operationIds.has(operation.operation_id)) fail(`operation_id 重复 ${operation.operation_id}`)
      operationIds.add(operation.operation_id)
      if (!validateBatchPath(operation.path) || operation.move_from && !validateBatchPath(operation.move_from)) fail(`manifest 包含不安全路径 ${operation.operation_id}`)
    }
    const expectedPayload = payloadPaths(manifest)
    const payloadEntries = entries.filter((item) => !item.directory && item.zipPath !== 'batch.json')
    for (const item of payloadEntries) if (!expectedPayload.has(item.path)) fail(`ZIP 包含未声明 payload ${item.zipPath}`)
    for (const path of expectedPayload) if (!payloadEntries.some((item) => item.path === path)) fail(`manifest 声明的 payload 缺失 ${path}`)
    await mkdir(resolve(stagingRunRoot, 'extracted', manifest.batch_id), { recursive: true })
    const stagingRoot = resolve(stagingRunRoot, 'extracted', manifest.batch_id)
    await writeFile(resolve(stagingRoot, 'batch.json'), manifestBytes, { flag: 'wx' })
    const scanned: ScannedEntry[] = []
    let actualTotal = 0
    for (const item of payloadEntries) {
      const scannedEntry = await extractEntry(zip, item, stagingRoot)
      actualTotal += scannedEntry.actual_uncompressed_bytes
      if (actualTotal > BATCH_LIMITS.maxTotalBytes) fail('总实际解压大小超限')
      const operation = manifest.operations.find((candidate) => candidate.path === item.path && candidate.action !== 'delete')
      if (!operation || operation.payload_sha256 !== scannedEntry.sha256) fail(`payload hash 不匹配 ${item.path}`)
      if (operation.kind === 'media') validateMedia(item.path, await readFile(resolve(stagingRoot, item.path)))
      scanned.push(scannedEntry)
    }
    const batchEntry: ScannedEntry = { zip_path: 'batch.json', path: 'batch.json', compressed_bytes: manifests[0].entry.compressedSize, declared_uncompressed_bytes: manifests[0].entry.uncompressedSize, actual_uncompressed_bytes: manifestBytes.byteLength, sha256: createHash('sha256').update(manifestBytes).digest('hex') }
    const result: ScannedBatch = { zip_path: relative(repositoryRoot, zipAbsolutePath).replaceAll('\\', '/'), zip_sha256: await hashFile(zipAbsolutePath), compressed_bytes: entries.reduce((total, item) => total + item.entry.compressedSize, 0), declared_uncompressed_bytes: declaredTotal, actual_uncompressed_bytes: actualTotal + batchEntry.actual_uncompressed_bytes, entry_count: entries.length, manifest, entries: [batchEntry, ...scanned], ...(options.retainStaging ? { staging_path: stagingRoot } : {}) }
    if (!options.retainStaging) await rm(stagingRunRoot, { recursive: true, force: true })
    return result
  } catch (error) {
    await rm(stagingRunRoot, { recursive: true, force: true })
    if (error instanceof Error && error.message.startsWith('知识批次 ZIP 不安全：')) throw error
    throw new Error('知识批次 ZIP 不安全：无法安全读取 ZIP central directory 或 entry stream。', { cause: error })
  } finally {
    zip.close()
  }
}
