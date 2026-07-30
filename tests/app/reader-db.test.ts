import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  defaultReaderPreferences,
  DATABASE_VERSION,
  loadReaderPreferences,
  MyriadAtlasDatabase,
  normalizeInterruptedOfflineJobs,
  readerDb,
  saveReaderPreferences,
  saveReadingProgress,
} from '../../src/app/state/reader-db'

describe('reader IndexedDB v4', () => {
  beforeEach(async () => {
    await readerDb.delete()
    await readerDb.open()
  })

  it('creates default settings and persists updated preferences', async () => {
    await expect(loadReaderPreferences()).resolves.toEqual(defaultReaderPreferences)
    await saveReaderPreferences({ ...defaultReaderPreferences, fontSize: 20, theme: 'warm' })
    await expect(loadReaderPreferences()).resolves.toMatchObject({ fontSize: 20, theme: 'warm' })
  })

  it('clamps reading progress and initializes every v2 state field', async () => {
    await saveReadingProgress('reader-preview', 1.8, 'unknown-anchor', ['known-anchor'])
    const state = await readerDb.nodeStates.get('reader-preview')
    expect(state?.reading_progress).toMatchObject({ ratio: 1, anchor: '' })
    expect(state).toMatchObject({
      completed: false, favorite: false, unknown: false, uninterested: false,
      uninterested_note: '', uninterested_at: null,
    })
  })

  it('migrates a real v1 record without losing state or timestamps', async () => {
    await readerDb.delete()
    const legacy = new Dexie('myriad-atlas')
    legacy.version(1).stores({ settings: '&key', nodeStates: '&node_id, updated_at' })
    await legacy.open()
    await legacy.table('nodeStates').put({
      node_id: 'legacy', completed: true, completed_at: 'old-complete',
      favorite: true, favorite_at: 'old-favorite', unknown: true, unknown_note: 'note',
      unknown_updated_at: 'old-unknown', reading_progress: { ratio: 0.4, anchor: 'a', updated_at: 'old-progress' },
      updated_at: 'old-update',
    })
    legacy.close()
    const migrated = new MyriadAtlasDatabase()
    await migrated.open()
    expect(await migrated.nodeStates.get('legacy')).toEqual({
      node_id: 'legacy', completed: true, completed_at: 'old-complete',
      favorite: true, favorite_at: 'old-favorite', unknown: true, unknown_note: 'note',
      unknown_updated_at: 'old-unknown', uninterested: false, uninterested_note: '', uninterested_at: null,
      reading_progress: { ratio: 0.4, anchor: 'a', updated_at: 'old-progress' }, updated_at: 'old-update',
    })
    expect(migrated.tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      'routePositions', 'questionChains', 'questionDrafts', 'pendingRemovals', 'opinions',
    ]))
    migrated.close()
  })

  it('upgrades v2 personal tables without clearing them and initializes v4 offline metadata', async () => {
    const name = `myriad-v2-${Date.now()}`
    const legacy = new Dexie(name)
    legacy.version(1).stores({ settings: '&key', nodeStates: '&node_id, updated_at' })
    legacy.version(2).stores({
      settings: '&key', nodeStates: '&node_id, completed, favorite, unknown, uninterested, updated_at',
      routePositions: '&route_id, updated_at', questionChains: '&chain_id, root_node_id, status, updated_at',
      questionDrafts: '&draft_id, chain_id, status, updated_at', pendingRemovals: '&id, kind, target_id, updated_at', opinions: '&id, scope, route_id, updated_at',
    })
    await legacy.open()
    await legacy.table('nodeStates').put({ node_id: 'legacy-v2', completed: true, updated_at: 'old' })
    await legacy.table('pendingRemovals').put({ id: 'legacy-removal', kind: 'qa-chain', target_id: 'qa-0001', root_node_id: 'node', note: '', previous_status: 'hidden', created_at: 'old', updated_at: 'old' })
    legacy.close()

    const migrated = new MyriadAtlasDatabase(name)
    await migrated.open()
    expect(DATABASE_VERSION).toBe(4)
    expect(await migrated.nodeStates.get('legacy-v2')).toMatchObject({ completed: true, updated_at: 'old' })
    expect(await migrated.pendingRemovals.get('legacy-removal')).not.toHaveProperty('previous_status')
    expect(await migrated.offlineJobs.count()).toBe(0)
    expect(await migrated.offlineFiles.count()).toBe(0)
    expect(await migrated.appMeta.count()).toBe(0)
    migrated.close()
    const reopened = new MyriadAtlasDatabase(name)
    await reopened.open()
    expect(await reopened.nodeStates.get('legacy-v2')).toMatchObject({ completed: true })
    reopened.close()
    await Dexie.delete(name)
  })

  it('normalizes interrupted downloads without changing completed files', async () => {
    await readerDb.offlineJobs.put({
      job_id: 'job', content_version: '2026.07.30-01', manifest_fingerprint: 'f'.repeat(64), cache_name: 'content-job', status: 'downloading',
      payload_bytes_total: 10, payload_bytes_done: 5, required_storage_bytes: 20, bytes_total: 10, bytes_done: 5, files_total: 2, files_done: 1, current_path: '_generated/catalog.json', error_code: null, error_message: null, created_at: 'old', updated_at: 'old',
    })
    await readerDb.offlineFiles.bulkPut([
      { job_id: 'job', path: '_generated/catalog.json', kind: 'catalog', bytes: 5, sha256: 'a'.repeat(64), status: 'downloading', attempts: 1, error_message: null, updated_at: 'old' },
      { job_id: 'job', path: '_generated/routes.json', kind: 'routes-index', bytes: 5, sha256: 'b'.repeat(64), status: 'complete', attempts: 1, error_message: null, updated_at: 'old' },
    ])
    await normalizeInterruptedOfflineJobs()
    expect(await readerDb.offlineJobs.get('job')).toMatchObject({ status: 'paused', error_code: 'interrupted', current_path: null })
    expect(await readerDb.offlineFiles.get(['job', '_generated/catalog.json'])).toMatchObject({ status: 'pending' })
    expect(await readerDb.offlineFiles.get(['job', '_generated/routes.json'])).toMatchObject({ status: 'complete' })
  })

  it('keeps v3 offline jobs and adds v4 payload fields during the transaction migration', async () => {
    const name = `myriad-v3-${Date.now()}`
    const legacy = new Dexie(name)
    legacy.version(3).stores({
      settings: '&key', nodeStates: '&node_id, completed, favorite, unknown, uninterested, updated_at', routePositions: '&route_id, updated_at',
      questionChains: '&chain_id, root_node_id, status, updated_at', questionDrafts: '&draft_id, chain_id, status, updated_at',
      pendingRemovals: '&id, kind, target_id, updated_at', opinions: '&id, scope, route_id, updated_at',
      offlineJobs: '&job_id, [content_version+manifest_fingerprint], status, updated_at', offlineFiles: '[job_id+path], job_id, status, updated_at', appMeta: '&key, updated_at',
    })
    await legacy.open()
    await legacy.table('offlineJobs').put({ job_id: 'legacy-job', content_version: '2026.07.30-01', manifest_fingerprint: 'a'.repeat(64), cache_name: 'legacy', status: 'paused', bytes_total: 19, bytes_done: 7, files_total: 2, files_done: 1, current_path: null, error_code: null, error_message: null, created_at: 'old', updated_at: 'old' })
    legacy.close()

    const migrated = new MyriadAtlasDatabase(name)
    await migrated.open()
    expect(await migrated.offlineJobs.get('legacy-job')).toMatchObject({ payload_bytes_total: 19, payload_bytes_done: 7, required_storage_bytes: 19, bytes_total: 19, bytes_done: 7 })
    migrated.close()
    await Dexie.delete(name)
  })

  it('rolls back an upgrade transaction that throws', async () => {
    const name = `myriad-rollback-${Date.now()}`
    const v1 = new Dexie(name)
    v1.version(1).stores({ values: '&id' })
    await v1.open()
    await v1.table('values').put({ id: 'kept' })
    v1.close()
    const failing = new Dexie(name)
    failing.version(1).stores({ values: '&id' })
    failing.version(2).stores({ values: '&id', extra: '&id' }).upgrade(() => { throw new Error('migration failed') })
    await expect(failing.open()).rejects.toThrow('migration failed')
    failing.close()
    const reopened = new Dexie(name)
    reopened.version(1).stores({ values: '&id' })
    await reopened.open()
    expect(await reopened.table('values').get('kept')).toEqual({ id: 'kept' })
    reopened.close()
    await Dexie.delete(name)
  })
})
