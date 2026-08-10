import { describe, expect, it } from 'vitest'
import { nodeVisualState } from '../../src/app/data/node-visual-state'
import type { NodeState } from '../../src/app/state/reader-db'

const state = (values: Partial<NodeState>): NodeState => ({
  node_id: 'node', completed: false, completed_at: null, favorite: false, favorite_at: null, unknown: false, unknown_note: '', unknown_updated_at: null,
  uninterested: false, uninterested_note: '', uninterested_at: null, reading_progress: null, updated_at: '', ...values,
})

describe('node visual state', () => {
  it('uses stable semantic priority instead of color-only status', () => {
    expect(nodeVisualState(state({ completed: true, favorite: true, unknown: true }), 'normal')).toBe('completed')
    expect(nodeVisualState(state({ unknown: true, reading_progress: { ratio: .5, anchor: '', updated_at: '' } }), 'normal')).toBe('unknown')
    expect(nodeVisualState(state({ reading_progress: { ratio: .5, anchor: '', updated_at: '' } }), 'normal')).toBe('current')
    expect(nodeVisualState(state({ favorite: true }), 'normal')).toBe('favorite')
    expect(nodeVisualState(undefined, 'roaming')).toBe('roaming')
    expect(nodeVisualState(undefined, 'normal')).toBe('unread')
  })
})
