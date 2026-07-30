import { beforeEach, describe, expect, it } from 'vitest'
import { defaultReaderPreferences, loadReaderPreferences, readerDb, saveReaderPreferences, saveReadingProgress } from '../../src/app/state/reader-db'

describe('reader IndexedDB v1', () => {
  beforeEach(async () => {
    await readerDb.delete()
    await readerDb.open()
  })

  it('creates default settings and persists updated preferences', async () => {
    await expect(loadReaderPreferences()).resolves.toEqual(defaultReaderPreferences)
    await saveReaderPreferences({ ...defaultReaderPreferences, fontSize: 20, theme: 'warm' })
    await expect(loadReaderPreferences()).resolves.toMatchObject({ fontSize: 20, theme: 'warm' })
  })

  it('clamps reading progress and only accepts anchors from the node TOC', async () => {
    await saveReadingProgress('reader-preview', 1.8, 'unknown-anchor', ['known-anchor'])
    const state = await readerDb.nodeStates.get('reader-preview')

    expect(state?.reading_progress).toMatchObject({ ratio: 1, anchor: '' })
    expect(state).toMatchObject({ completed: false, favorite: false, unknown: false })
  })
})
