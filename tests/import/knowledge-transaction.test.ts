import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyBatchTransaction, transactionJournalPath } from '../../scripts/knowledge/transaction'
import type { ScannedBatch } from '../../scripts/knowledge/scan-batch'

function hash(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
function node(id: string, title = id): Buffer { return Buffer.from(`---\nid: ${id}\ntitle: ${title}\ndomain_id: domain\ncourse_id: course\nsummary: Summary\ntakeaways:\n  - Takeaway\n---\n\nBody.\n`) }
function route(id: string, code: string): Buffer { return Buffer.from(`id: ${id}\ncode: ${code}\nname: Route\nsummary: Summary\nstages: []\n`) }

async function fixture(): Promise<{ root: string; batch: ScannedBatch; before: Record<string, Buffer> }> {
  const root = await mkdtemp(join(tmpdir(), 'myriad-transaction-'))
  const before = { node: node('node-a', 'Before'), route: route('route-a', 'ROUTE-A') }
  await mkdir(resolve(root, 'src/content'), { recursive: true }); await mkdir(resolve(root, 'src/data/routes'), { recursive: true }); await mkdir(resolve(root, 'public/media'), { recursive: true })
  await writeFile(resolve(root, 'src/content/node-a.md'), before.node); await writeFile(resolve(root, 'src/data/routes/route-a.yaml'), before.route)
  const staging = resolve(root, 'staging'); await mkdir(resolve(staging, 'src/content'), { recursive: true }); await mkdir(resolve(staging, 'src/data/routes'), { recursive: true })
  const added = node('node-b'); const replaced = node('node-a', 'After'); await writeFile(resolve(staging, 'src/content/node-b.md'), added); await writeFile(resolve(staging, 'src/content/node-a.md'), replaced); await writeFile(resolve(staging, 'src/data/routes/route-b.yaml'), before.route)
  const operations = [
    { operation_id: 'op-0001', action: 'add' as const, kind: 'node' as const, path: 'src/content/node-b.md', entity_id: 'node-b', payload_sha256: hash(added) },
    { operation_id: 'op-0002', action: 'replace' as const, kind: 'node' as const, path: 'src/content/node-a.md', entity_id: 'node-a', expected_previous_sha256: hash(before.node), payload_sha256: hash(replaced) },
    { operation_id: 'op-0003', action: 'add' as const, kind: 'route' as const, path: 'src/data/routes/route-b.yaml', entity_id: 'route-a', move_from: 'src/data/routes/route-a.yaml', expected_previous_sha256: hash(before.route), payload_sha256: hash(before.route) },
  ]
  return { root, before, batch: { zip_path: 'test.zip', zip_sha256: '0'.repeat(64), compressed_bytes: 0, declared_uncompressed_bytes: 0, actual_uncompressed_bytes: 0, entry_count: 0, staging_path: staging, entries: [], manifest: { schema_version: 1, batch_id: 'batch-20260731-001-test', created_at: '2026-07-31T00:00:00.000Z', released_on: '2026-07-31', base_content_version: '2026.07.30-01', target_content_version: '2026.07.31-01', summary: 'test', operations } } }
}

describe('knowledge file transactions', () => {
  it('applies add, replace and move as one transaction', async () => {
    const { root, batch } = await fixture()
    await applyBatchTransaction(root, batch, { runId: 'success' })
    await expect(readFile(resolve(root, 'src/content/node-b.md'))).resolves.toEqual(node('node-b'))
    await expect(readFile(resolve(root, 'src/content/node-a.md'))).resolves.toEqual(node('node-a', 'After'))
    await expect(readFile(resolve(root, 'src/data/routes/route-a.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(resolve(root, 'src/data/routes/route-b.yaml'))).resolves.toEqual(route('route-a', 'ROUTE-A'))
    expect(await transactionJournalPath(root, 'success')).toBeUndefined()
    await rm(root, { recursive: true, force: true })
  })

  it('rejects stale source hashes before it changes a file', async () => {
    const { root, batch, before } = await fixture()
    batch.manifest.operations[1].expected_previous_sha256 = 'f'.repeat(64)
    await expect(applyBatchTransaction(root, batch)).rejects.toThrow('前置内容哈希不匹配')
    await expect(readFile(resolve(root, 'src/content/node-a.md'))).resolves.toEqual(before.node)
    await rm(root, { recursive: true, force: true })
  })

  it('restores raw bytes after a write failure', async () => {
    const { root, batch, before } = await fixture()
    await expect(applyBatchTransaction(root, batch, { runId: 'rollback', onWrite: async () => { throw new Error('injected') } })).rejects.toThrow('injected')
    await expect(readFile(resolve(root, 'src/content/node-a.md'))).resolves.toEqual(before.node)
    await expect(readFile(resolve(root, 'src/data/routes/route-a.yaml'))).resolves.toEqual(before.route)
    await expect(readFile(resolve(root, 'src/content/node-b.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await transactionJournalPath(root, 'rollback')).toBeUndefined()
    await rm(root, { recursive: true, force: true })
  })

  it('preserves the journal when rollback itself fails', async () => {
    const { root, batch } = await fixture()
    await expect(applyBatchTransaction(root, batch, { runId: 'journal', onWrite: async () => { throw new Error('injected') }, onRestore: async () => { throw new Error('restore injected') } })).rejects.toThrow('回滚失败')
    expect(await transactionJournalPath(root, 'journal')).toBe('.tmp/knowledge-import/journal/transaction/journal.json')
    await rm(root, { recursive: true, force: true })
  })
})
