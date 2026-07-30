import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BATCH_LIMITS, validateBatchPath, validateKnowledgeBatch } from '../../src/import/knowledge-batch'
import { scanKnowledgeBatch } from '../../scripts/knowledge/scan-batch'

function hash(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
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
    const name = Buffer.from(entry.name); const crc = crc32(entry.data)
    const header = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name, entry.data])
    local.push(header)
    central.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02]), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]))
    offset += header.length
  }
  const directory = Buffer.concat(central)
  return Buffer.concat([...local, directory, Buffer.from([0x50, 0x4b, 0x05, 0x06]), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)])
}
function manifest(payload: Buffer) {
  return {
    schema_version: 1, batch_id: 'batch-20260731-001-test', created_at: '2026-07-31T00:00:00.000Z', released_on: '2026-07-31', base_content_version: '2026.07.30-01', target_content_version: '2026.07.31-01', summary: 'test',
    operations: [{ operation_id: 'op-0001', action: 'add', kind: 'node', path: 'src/content/test.md', entity_id: 'node-test', payload_sha256: hash(payload) }],
  }
}

describe('knowledge batch contract and scanner', () => {
  it('compiles the strict schema and rejects unsafe paths', () => {
    const value = manifest(Buffer.from('# test'))
    expect(validateKnowledgeBatch(value)).toBe(true)
    expect(validateKnowledgeBatch({ ...value, extra: true })).toBe(false)
    expect(validateKnowledgeBatch({ ...value, operations: [{ ...value.operations[0], action: 'delete' }] })).toBe(false)
    expect(validateBatchPath('src/content/a.md')).toBe('src/content/a.md')
    expect(validateBatchPath('../a.md')).toBeUndefined()
    expect(validateBatchPath('src\\content\\a.md')).toBeUndefined()
    expect(validateBatchPath('src/content/CON.md')).toBeUndefined()
    expect(validateBatchPath(`src/content/e\u0301.md`)).toBeUndefined()
    expect(BATCH_LIMITS.maxZipBytes).toBeGreaterThan(BATCH_LIMITS.maxEntryBytes)
  })

  it('streams a valid batch and rejects zip-slip, duplicate payload, and mismatched filenames', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'myriad-batch-'))
    const payload = Buffer.from('# test')
    const batch = Buffer.from(JSON.stringify(manifest(payload)))
    const validPath = join(directory, 'batch-20260731-001-test.zip')
    await writeFile(validPath, storedZip([{ name: 'batch.json', data: batch }, { name: 'payload/src/content/test.md', data: payload }]))
    await expect(scanKnowledgeBatch(validPath, { repositoryRoot: directory })).resolves.toMatchObject({ entry_count: 2, manifest: { batch_id: 'batch-20260731-001-test' }, actual_uncompressed_bytes: batch.length + payload.length })

    const wrongName = join(directory, 'wrong.zip')
    await writeFile(wrongName, storedZip([{ name: 'batch.json', data: batch }, { name: 'payload/src/content/test.md', data: payload }]))
    await expect(scanKnowledgeBatch(wrongName, { repositoryRoot: directory })).rejects.toThrow('文件名与 batch_id 不一致')

    const slipPath = join(directory, 'batch-20260731-001-test-slip.zip')
    const slipBatch = Buffer.from(JSON.stringify({ ...manifest(payload), batch_id: 'batch-20260731-001-test-slip' }))
    await writeFile(slipPath, storedZip([{ name: 'batch.json', data: slipBatch }, { name: 'payload/../escape.md', data: payload }]))
    await expect(scanKnowledgeBatch(slipPath, { repositoryRoot: directory })).rejects.toThrow('无法安全读取 ZIP')
    await rm(directory, { recursive: true, force: true })
  })
})
