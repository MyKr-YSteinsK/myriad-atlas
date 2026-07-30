import { beforeEach, describe, expect, it, vi } from 'vitest'
import { countCurrentPersonalData, createPersonalBackup, applyPersonalRestore, preparePersonalRestore } from '../../src/app/backup/personal-backup'
import { readerDb } from '../../src/app/state/reader-db'
import { localState } from '../../src/app/state/local-state'

const version = '2026.07.30-01'
const timestamp = '2026-07-30T12:00:00.000Z'
const context = { appVersion: '0.1.0', knowledgeVersion: version, nodeIds: ['node-a'], routeIds: ['route-a'], tocIdsByNode: new Map([['node-a', new Set(['known'])]]), qaIndex: { schema_version: 1 as const, content_version: version, chains: [] } }

function chain(chainId = 'qa-0001', reserved = chainId) {
  return { chain_id: chainId, root_node_id: 'node-a', reserved_first_answer_id: reserved, status: 'awaiting-import' as const, created_at: timestamp, updated_at: timestamp }
}

function draft(chainId: string, parentNodeId: string | null) {
  return {
    draft_id: `${chainId}:draft`, chain_id: chainId, root_node_id: 'node-a', parent_node_id: parentNodeId,
    question: 'question', source_title: 'source', source_domain_id: 'domain', source_domain_name: 'Domain', source_course_id: 'course', source_course_name: 'Course', source_path: 'src.md', source_content_version: version,
    status: 'awaiting-import' as const, copied_at: null, created_at: timestamp, updated_at: timestamp,
  }
}

describe('personal backup restore', () => {
  beforeEach(async () => {
    await readerDb.delete()
    await readerDb.open()
  })

  it('previews compatibility, normalizes settings, and reports skipped unavailable records', async () => {
    await localState.toggleCompleted('node-a')
    await localState.toggleFavorite('node-missing')
    await localState.saveRoutePosition({ route_id: 'route-missing', stage_id: 'stage', module_id: 'module', node_id: 'node-missing' })
    await localState.saveReaderPreferences({ fontSize: 18, lineHeight: 1.75, paragraphSpacing: 0.85, gutter: 20, contentWidth: 720, font: 'system', theme: 'system', showProgress: true, showToc: true, codeWrap: false })
    const backup = await createPersonalBackup(version, timestamp)
    const state = backup.data.node_states.find((entry) => entry.node_id === 'node-a')!
    state.reading_progress = { ratio: 0.5, anchor: 'gone', updated_at: timestamp }
    backup.data.settings[0].value.fontSize = 999
    const prepared = await preparePersonalRestore(backup, context)

    expect(prepared.data.node_states).toHaveLength(1)
    expect(prepared.data.node_states[0].reading_progress?.anchor).toBe('')
    expect(prepared.data.settings[0].value.fontSize).toBe(40)
    expect(prepared.summary.skipped).toMatchObject({ 'missing-node-state': 1, 'missing-route-position': 1 })
    await expect(preparePersonalRestore({ ...backup, knowledge_version: '2026.08.01-01' }, context)).rejects.toThrow('更新知识')
  })

  it('replaces personal tables atomically while preserving offline metadata', async () => {
    await localState.toggleCompleted('node-a')
    const backup = await createPersonalBackup(version, timestamp)
    const prepared = await preparePersonalRestore(backup, context)
    await localState.toggleFavorite('node-a')
    await readerDb.offlineJobs.put({ job_id: 'offline', content_version: version, manifest_fingerprint: 'a'.repeat(64), cache_name: 'cache', status: 'active', payload_bytes_total: 0, payload_bytes_done: 0, required_storage_bytes: 0, bytes_total: 0, bytes_done: 0, files_total: 0, files_done: 0, current_path: null, error_code: null, error_message: null, created_at: timestamp, updated_at: timestamp })

    await applyPersonalRestore(prepared)
    expect(await localState.getNode('node-a')).toMatchObject({ completed: true, favorite: false })
    expect(await readerDb.offlineJobs.get('offline')).toBeTruthy()
    expect(await localState.getMutationCount()).toBe(0)
  })

  it('keeps the old personal state if the replacement transaction fails', async () => {
    await localState.toggleFavorite('node-a')
    const backup = await createPersonalBackup(version, timestamp)
    const prepared = await preparePersonalRestore(backup, context)
    await localState.toggleCompleted('node-a')
    const failure = vi.spyOn(readerDb.opinions, 'bulkPut').mockRejectedValueOnce(new Error('write-failed'))
    await expect(applyPersonalRestore(prepared)).rejects.toThrow('write-failed')
    expect(await localState.getNode('node-a')).toMatchObject({ completed: true, favorite: true })
    failure.mockRestore()
  })

  it('rejects duplicate reservations and a reservation already owned by a different formal root', async () => {
    const backup = await createPersonalBackup(version, timestamp)
    backup.data.question_chains = [chain('qa-0001'), chain('qa-0002', 'qa-0001')]
    let prepared = await preparePersonalRestore(backup, context)
    expect(prepared.summary.skipped).toMatchObject({ 'duplicate-reserved-first-answer-id': 2 })

    backup.data.question_chains = [chain('qa-0001')]
    prepared = await preparePersonalRestore(backup, {
      ...context,
      qaIndex: {
        schema_version: 1, content_version: version,
        chains: [{ chain_id: 'qa-9999', root_node_id: 'other-root', answers: [{ node_id: 'qa-0001', parent_node_id: null, prompt: '', title: '', source_content_version: version, node_path: '' }] }],
      },
    })
    expect(prepared.summary.skipped).toMatchObject({ 'reserved-id-different-root': 1 })
  })

  it('accepts only a follow-up whose parent is the last answer of the same formal chain', async () => {
    const backup = await createPersonalBackup(version, timestamp)
    backup.data.question_chains = [chain()]
    backup.data.question_drafts = [draft('qa-0001', 'qa-0001')]
    const qaIndex = {
      schema_version: 1 as const, content_version: version,
      chains: [{ chain_id: 'qa-0001', root_node_id: 'node-a', answers: [
        { node_id: 'qa-0001', parent_node_id: null, prompt: '', title: '', source_content_version: version, node_path: '' },
        { node_id: 'qa-0002', parent_node_id: 'qa-0001', prompt: '', title: '', source_content_version: version, node_path: '' },
      ] }],
    }
    let prepared = await preparePersonalRestore(backup, { ...context, qaIndex })
    expect(prepared.summary.skipped).toMatchObject({ 'invalid-question-parent': 1 })

    backup.data.question_drafts = [draft('qa-0001', 'qa-0002')]
    prepared = await preparePersonalRestore(backup, { ...context, qaIndex })
    expect(prepared.data.question_chains).toHaveLength(1)
    expect(prepared.data.question_drafts).toHaveLength(1)
  })

  it('counts the current data that will be cleared, including settings and route positions', async () => {
    await localState.saveReaderPreferences({ fontSize: 18, lineHeight: 1.75, paragraphSpacing: 0.85, gutter: 20, contentWidth: 720, font: 'system', theme: 'system', showProgress: true, showToc: true, codeWrap: false })
    await localState.saveRoutePosition({ route_id: 'route-a', stage_id: 'stage', module_id: 'module', node_id: 'node-a' })
    expect(await countCurrentPersonalData()).toBe(2)
    const backup = await createPersonalBackup(version, timestamp)
    const prepared = await preparePersonalRestore(backup, context)
    expect(prepared.summary.current_clear).toBe(2)
    expect(prepared.summary.imported).toBe(2)
  })
})
