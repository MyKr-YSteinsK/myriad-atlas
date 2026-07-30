import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  defaultReaderPreferences,
  loadReaderPreferences,
  MyriadAtlasDatabase,
  readerDb,
  saveReaderPreferences,
  saveReadingProgress,
} from '../../src/app/state/reader-db'

describe('reader IndexedDB v2', () => {
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
