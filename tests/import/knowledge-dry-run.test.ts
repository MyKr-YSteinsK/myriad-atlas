import { createHash } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAllContent } from '../../scripts/content/build-all'
import { createContentWorkspace } from '../../scripts/content/config'
import { dryRunKnowledgeUpdate, readImportedBatchIndex } from '../../scripts/knowledge/dry-run'

function hash(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
function crc32(value: Buffer): number { let crc = 0xffffffff; for (const byte of value) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1 } return (crc ^ 0xffffffff) >>> 0 }
function u16(value: number): Buffer { const result = Buffer.alloc(2); result.writeUInt16LE(value); return result }
function u32(value: number): Buffer { const result = Buffer.alloc(4); result.writeUInt32LE(value); return result }
function storedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const crc = crc32(entry.data)
    const header = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name, entry.data])
    local.push(header); central.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02]), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name])); offset += header.length
  }
  const directory = Buffer.concat(central)
  return Buffer.concat([...local, directory, Buffer.from([0x50, 0x4b, 0x05, 0x06]), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)])
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'myriad-dry-run-'))
  for (const directory of ['src', 'schemas', 'generated'] as const) await cp(resolve(process.cwd(), directory), resolve(root, directory), { recursive: true })
  await mkdir(resolve(root, 'public/media'), { recursive: true })
  await buildAllContent({ workspace: createContentWorkspace(root, resolve(root, 'schemas')), targetRoot: resolve(root, 'public/_generated'), publicDirectory: resolve(root, 'public') })
  await mkdir(resolve(root, 'inbox/batches'), { recursive: true })
  await writeFile(resolve(root, 'generated/imported-batches.json'), '{"schema_version":1,"batches":[]}\n')
  return root
}

describe('knowledge update dry-run', () => {
  it('does nothing when inbox has no ZIP and validates an empty import index', async () => {
    const root = await fixtureRoot()
    await expect(dryRunKnowledgeUpdate({ repositoryRoot: root, git: { head: 'test', clean: true } })).resolves.toBeUndefined()
    await expect(readImportedBatchIndex(root)).resolves.toEqual({ schema_version: 1, batches: [] })
    await rm(root, { recursive: true, force: true })
  })

  it('simulates an ordered media batch without changing the source workspace', async () => {
    const root = await fixtureRoot()
    const payload = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    const manifest = Buffer.from(JSON.stringify({ schema_version: 1, batch_id: 'batch-20260731-001-test', created_at: '2026-07-31T00:00:00.000Z', released_on: '2026-07-31', base_content_version: '2026.07.30-01', target_content_version: '2026.07.31-01', summary: 'test media import', operations: [{ operation_id: 'op-0001', action: 'add', kind: 'media', path: 'public/media/test.png', entity_id: 'test-media', payload_sha256: hash(payload) }] }))
    await writeFile(resolve(root, 'inbox/batches/batch-20260731-001-test.zip'), storedZip([{ name: 'batch.json', data: manifest }, { name: 'payload/public/media/test.png', data: payload }]))
    const report = await dryRunKnowledgeUpdate({ repositoryRoot: root, runId: 'test-run', git: { head: 'test', clean: true } })
    expect(report).toMatchObject({ target_content_version: '2026.07.31-01', ordered_batch_ids: ['batch-20260731-001-test'], conclusion: 'dry-run 未修改正式源' })
    expect(await readFile(resolve(root, 'inbox/reports/test-run-dry-run.json'), 'utf8')).toContain('APPLY:1:2026.07.31-01')
    await expect(readFile(resolve(root, 'public/media/test.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(root, { recursive: true, force: true })
  })
})
