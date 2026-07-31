import { beforeEach, describe, expect, it, vi } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import backupSchema from '../../schemas/backup/personal-backup-v1.schema.json'
import { defaultReaderPreferences, readerDb } from '../../src/app/state/reader-db'
import { localState } from '../../src/app/state/local-state'
import { backupFileName, backupJson, createPersonalBackup, exportPersonalBackup, getBackupReminderState, startBackupExport, validatePersonalBackup } from '../../src/app/backup/personal-backup'

const timestamp = '2026-07-30T12:34:56.000Z'
const localBackupTime = new Date(2026, 6, 30, 20, 34, 56)

describe('personal backup export', () => {
  beforeEach(async () => {
    await readerDb.delete()
    await readerDb.open()
  })

  it('uses one strict schema and exports a stable personal-only snapshot', async () => {
    expect(() => new Ajv2020({ allErrors: true, strict: true }).compile(backupSchema)).not.toThrow()
    await localState.saveReaderPreferences(defaultReaderPreferences)
    await localState.toggleFavorite('node-b')
    await localState.toggleCompleted('node-a')
    await localState.saveRoutePosition({ route_id: 'route-b', stage_id: 'stage', module_id: 'module', node_id: 'node-b' })
    await readerDb.offlineJobs.put({ job_id: 'offline', content_version: '2026.07.30-01', manifest_fingerprint: 'a'.repeat(64), cache_name: 'cache', status: 'failed', payload_bytes_total: 0, payload_bytes_done: 0, required_storage_bytes: 0, bytes_total: 0, bytes_done: 0, files_total: 0, files_done: 0, current_path: null, error_code: 'test', error_message: 'do not export', created_at: timestamp, updated_at: timestamp })
    const backup = await createPersonalBackup('2026.07.30-01', timestamp, '0.1.0')

    expect(validatePersonalBackup(backup)).toBe(true)
    expect(backup.data.node_states.map((entry) => entry.node_id)).toEqual(['node-a', 'node-b'])
    expect(backupJson(backup)).not.toContain('offline')
    expect(backupJson(backup)).not.toContain('do not export')
    expect(validatePersonalBackup(JSON.parse('{"__proto__":{"polluted":true}}'))).toBe(false)
  })

  it('uses iPhone sharing when available, falls back to download, and only marks a successful launch', async () => {
    const backup = await createPersonalBackup('2026.07.30-01', timestamp)
    const share = vi.fn(async () => undefined)
    await expect(startBackupExport(backup, {
      share, canShare: () => true, createFile: (parts, name, options) => new File(parts, name, options),
    })).resolves.toBe('shared')
    expect(share).toHaveBeenCalledOnce()

    const triggerDownload = vi.fn()
    const revokeObjectURL = vi.fn()
    const localBackup = await createPersonalBackup('2026.07.30-01', localBackupTime.toISOString())
    await expect(startBackupExport(localBackup, { createObjectURL: () => 'blob:test', revokeObjectURL, triggerDownload })).resolves.toBe('downloaded')
    expect(triggerDownload).toHaveBeenCalledWith('blob:test', 'myriad-atlas-backup-2026-07-30-203456.json')

    await expect(startBackupExport(backup, { share: async () => { throw new DOMException('cancelled', 'AbortError') }, canShare: () => true, createFile: (parts, name, options) => new File(parts, name, options) })).rejects.toThrow('cancelled')
    await localState.toggleCompleted('node-a')
    await exportPersonalBackup('2026.07.30-01', { createObjectURL: () => 'blob:success', triggerDownload: () => undefined })
    expect(await localState.getMutationCount()).toBe(0)
    expect(await localState.getAppMeta('backup.last-success')).toEqual(expect.any(String))
  })

  it('calculates backup reminder from personal mutations without counting reading progress', async () => {
    expect(await getBackupReminderState('2026.07.30-01', new Date(timestamp))).toMatchObject({ due: false, hasPersonalData: false })
    await localState.toggleCompleted('node-a')
    expect(await getBackupReminderState('2026.07.30-01', new Date(timestamp))).toMatchObject({ due: true, hasPersonalData: true })
    await localState.markBackupSuccessful(timestamp)
    await localState.saveReadingProgress('node-a', 0.4, '', [])
    expect(await getBackupReminderState('2026.07.30-01', new Date(timestamp))).toMatchObject({ due: false, mutationCount: 0 })
    for (let index = 0; index < 50; index += 1) await localState.toggleFavorite(`node-${index}`)
    expect(await getBackupReminderState('2026.07.30-01', new Date(timestamp))).toMatchObject({ due: true, mutationCount: 50 })
    expect(backupFileName(localBackupTime)).toBe('myriad-atlas-backup-2026-07-30-203456.json')
  })
})
