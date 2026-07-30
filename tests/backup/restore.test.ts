import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPersonalBackup, applyPersonalRestore, preparePersonalRestore } from '../../src/app/backup/personal-backup'
import { readerDb } from '../../src/app/state/reader-db'
import { localState } from '../../src/app/state/local-state'

const version = '2026.07.30-01'
const timestamp = '2026-07-30T12:00:00.000Z'
const context = { appVersion: '0.1.0', knowledgeVersion: version, nodeIds: ['node-a'], routeIds: ['route-a'], tocIdsByNode: new Map([['node-a', new Set(['known'])]]) }

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
    const prepared = preparePersonalRestore(backup, context)

    expect(prepared.data.node_states).toHaveLength(1)
    expect(prepared.data.node_states[0].reading_progress?.anchor).toBe('')
    expect(prepared.data.settings[0].value.fontSize).toBe(40)
    expect(prepared.summary.skipped).toMatchObject({ 'missing-node-state': 1, 'missing-route-position': 1 })
    await expect(Promise.resolve().then(() => preparePersonalRestore({ ...backup, knowledge_version: '2026.08.01-01' }, context))).rejects.toThrow('更新知识')
  })

  it('replaces personal tables atomically while preserving offline metadata', async () => {
    await localState.toggleCompleted('node-a')
    const backup = await createPersonalBackup(version, timestamp)
    const prepared = preparePersonalRestore(backup, context)
    await localState.toggleFavorite('node-a')
    await readerDb.offlineJobs.put({ job_id: 'offline', content_version: version, manifest_fingerprint: 'a'.repeat(64), cache_name: 'cache', status: 'active', bytes_total: 0, bytes_done: 0, files_total: 0, files_done: 0, current_path: null, error_code: null, error_message: null, created_at: timestamp, updated_at: timestamp })

    await applyPersonalRestore(prepared)
    expect(await localState.getNode('node-a')).toMatchObject({ completed: true, favorite: false })
    expect(await readerDb.offlineJobs.get('offline')).toBeTruthy()
    expect(await localState.getMutationCount()).toBe(0)
  })

  it('keeps the old personal state if the replacement transaction fails', async () => {
    await localState.toggleFavorite('node-a')
    const backup = await createPersonalBackup(version, timestamp)
    const prepared = preparePersonalRestore(backup, context)
    await localState.toggleCompleted('node-a')
    const failure = vi.spyOn(readerDb.opinions, 'bulkPut').mockRejectedValueOnce(new Error('write-failed'))
    await expect(applyPersonalRestore(prepared)).rejects.toThrow('write-failed')
    expect(await localState.getNode('node-a')).toMatchObject({ completed: true, favorite: true })
    failure.mockRestore()
  })
})
