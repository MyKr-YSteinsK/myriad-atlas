import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyBatchTransaction } from '../../scripts/knowledge/transaction'
import type { KnowledgeBatchOperationV1 } from '../../src/import/knowledge-batch'
import type { ScannedBatch } from '../../scripts/knowledge/scan-batch'

function hash(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
function node(id: string, extra = ''): Buffer { return Buffer.from(`---\nid: ${id}\ntitle: ${id}\ndomain_id: domain\ncourse_id: course\nsummary: Summary\ntakeaways:\n  - Takeaway\n${extra}---\n\nBody.\n`) }
function batch(operation: KnowledgeBatchOperationV1, staging: string): ScannedBatch { return { zip_path: 'test.zip', zip_sha256: '0'.repeat(64), compressed_bytes: 0, declared_uncompressed_bytes: 0, actual_uncompressed_bytes: 0, entry_count: 0, staging_path: staging, entries: [], manifest: { schema_version: 1, batch_id: 'batch-20260731-001-delete', created_at: '2026-07-31T00:00:00.000Z', released_on: '2026-07-31', base_content_version: '2026.07.30-01', target_content_version: '2026.07.31-01', summary: 'test', operations: [operation] } } }
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'myriad-delete-')); await mkdir(resolve(value, 'src/content'), { recursive: true }); await mkdir(resolve(value, 'src/data/routes'), { recursive: true }); await mkdir(resolve(value, 'public/media'), { recursive: true }); await mkdir(resolve(value, 'staging/src/content'), { recursive: true }); await mkdir(resolve(value, 'generated'), { recursive: true }); await writeFile(resolve(value, 'generated/content-tombstones.json'), '{"schema_version":1,"node_ids":[],"qa_chain_ids":[],"roaming_sequences":[],"qa_sequences":[]}\n'); return value }

describe('knowledge deletions and tombstones', () => {
  it('rejects deletion of a formally referenced node', async () => {
    const workspace = await root(); const source = node('node-a'); await writeFile(resolve(workspace, 'src/content/node-a.md'), source); await writeFile(resolve(workspace, 'src/content/node-b.md'), node('node-b', 'related:\n  - node-a\n'))
    const operation: KnowledgeBatchOperationV1 = { operation_id: 'op-0001', action: 'delete', kind: 'node', path: 'src/content/node-a.md', entity_id: 'node-a', expected_previous_sha256: hash(source), delete_mode: 'single-node' }
    await expect(applyBatchTransaction(workspace, batch(operation, resolve(workspace, 'staging')))).rejects.toThrow('仍被正式内容引用')
    await rm(workspace, { recursive: true, force: true })
  })

  it('deletes QA descendants and records permanent tombstones', async () => {
    const workspace = await root(); const rootNode = node('root'); const first = node('qa-0001', 'qa:\n  chain_id: qa-0001\n  root_node_id: root\n  parent_node_id: null\n  source_content_version: 2026.07.30-01\n  prompt: Prompt\n'); const second = node('qa-0002', 'qa:\n  chain_id: qa-0001\n  root_node_id: root\n  parent_node_id: qa-0001\n  source_content_version: 2026.07.30-01\n  prompt: Prompt\n')
    await writeFile(resolve(workspace, 'src/content/root.md'), rootNode); await writeFile(resolve(workspace, 'src/content/qa-0001.md'), first); await writeFile(resolve(workspace, 'src/content/qa-0002.md'), second)
    const operation: KnowledgeBatchOperationV1 = { operation_id: 'op-0001', action: 'delete', kind: 'node', path: 'src/content/qa-0001.md', entity_id: 'qa-0001', expected_previous_sha256: hash(first), delete_mode: 'qa-descendants', chain_id: 'qa-0001', from_node_id: 'qa-0001', expected_descendant_ids: ['qa-0002'] }
    await applyBatchTransaction(workspace, batch(operation, resolve(workspace, 'staging')))
    await expect(readFile(resolve(workspace, 'src/content/qa-0002.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(resolve(workspace, 'generated/content-tombstones.json'), 'utf8')).resolves.toContain('qa-0002')
    await rm(workspace, { recursive: true, force: true })
  })

  it('records a roaming sequence and blocks reusing a tombstoned node ID', async () => {
    const workspace = await root(); const source = node('roaming-a'); await writeFile(resolve(workspace, 'src/content/0001-test.md'), source)
    const roaming = node('roaming-a', '').toString('utf8').replace('domain_id: domain\ncourse_id: course', 'domain_id: knowledge-roaming\ncourse_id: knowledge-roaming-pool'); await writeFile(resolve(workspace, 'src/content/0001-test.md'), roaming)
    const operation: KnowledgeBatchOperationV1 = { operation_id: 'op-0001', action: 'delete', kind: 'node', path: 'src/content/0001-test.md', entity_id: 'roaming-a', expected_previous_sha256: hash(Buffer.from(roaming)), delete_mode: 'roaming-node' }
    await applyBatchTransaction(workspace, batch(operation, resolve(workspace, 'staging')))
    const added = node('roaming-a'); await writeFile(resolve(workspace, 'staging/src/content/reused.md'), added)
    await expect(applyBatchTransaction(workspace, batch({ operation_id: 'op-0002', action: 'add', kind: 'node', path: 'src/content/reused.md', entity_id: 'roaming-a', payload_sha256: hash(added) }, resolve(workspace, 'staging')))).rejects.toThrow('tombstoned')
    await expect(readFile(resolve(workspace, 'generated/content-tombstones.json'), 'utf8')).resolves.toContain('0001')
    await rm(workspace, { recursive: true, force: true })
  })
})
