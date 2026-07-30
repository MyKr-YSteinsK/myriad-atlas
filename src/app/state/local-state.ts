import { readerDb, saveReadingProgress, type LocalQuestionChain, type NodeState, type Opinion, type PendingRemoval, type QuestionDraft, type RoutePosition } from './reader-db'

const listeners = new Set<() => void>()
let revision = 0
function changed(): void {
  revision += 1
  for (const listener of listeners) listener()
}
function now(): string { return new Date().toISOString() }
function emptyNodeState(nodeId: string): NodeState {
  return {
    node_id: nodeId, completed: false, completed_at: null, favorite: false, favorite_at: null,
    unknown: false, unknown_note: '', unknown_updated_at: null, uninterested: false,
    uninterested_note: '', uninterested_at: null, reading_progress: null, updated_at: now(),
  }
}

async function updateNode(nodeId: string, update: (value: NodeState, timestamp: string) => void): Promise<NodeState> {
  const result = await readerDb.transaction('rw', readerDb.nodeStates, async () => {
    const value = await readerDb.nodeStates.get(nodeId) ?? emptyNodeState(nodeId)
    const timestamp = now()
    update(value, timestamp)
    value.updated_at = timestamp
    await readerDb.nodeStates.put(value)
    return value
  })
  changed()
  return result
}

export const localState = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getRevision: (): number => revision,
  getNode: (nodeId: string): Promise<NodeState | undefined> => readerDb.nodeStates.get(nodeId),
  listNodeStates: (): Promise<NodeState[]> => readerDb.nodeStates.toArray(),
  toggleCompleted: (nodeId: string): Promise<NodeState> => updateNode(nodeId, (value, timestamp) => {
    value.completed = !value.completed
    value.completed_at = value.completed ? timestamp : null
  }),
  toggleFavorite: (nodeId: string): Promise<NodeState> => updateNode(nodeId, (value, timestamp) => {
    value.favorite = !value.favorite
    value.favorite_at = value.favorite ? timestamp : null
  }),
  setUnknown: (nodeId: string, note: string): Promise<NodeState> => updateNode(nodeId, (value, timestamp) => {
    value.unknown = true
    value.unknown_note = note.trim()
    value.unknown_updated_at = timestamp
  }),
  clearUnknown: async (nodeId: string): Promise<string> => {
    let previousNote = ''
    await updateNode(nodeId, (value, timestamp) => {
      previousNote = value.unknown_note
      value.unknown = false
      value.unknown_note = ''
      value.unknown_updated_at = timestamp
    })
    return previousNote
  },
  undoClearUnknown: (nodeId: string, note: string): Promise<NodeState> => localState.setUnknown(nodeId, note),
  setUninterested: (nodeId: string, note: string): Promise<NodeState> => updateNode(nodeId, (value, timestamp) => {
    value.uninterested = true
    value.uninterested_note = note.trim()
    value.uninterested_at = timestamp
  }),
  clearUninterested: (nodeId: string): Promise<NodeState> => updateNode(nodeId, (value) => {
    value.uninterested = false
    value.uninterested_note = ''
    value.uninterested_at = null
  }),
  saveReadingProgress: async (nodeId: string, ratio: number, anchor: string, tocIds: string[]): Promise<void> => {
    await saveReadingProgress(nodeId, ratio, anchor, tocIds); changed()
  },
  saveRoutePosition: async (value: Omit<RoutePosition, 'updated_at'>): Promise<void> => {
    await readerDb.routePositions.put({ ...value, updated_at: now() }); changed()
  },
  saveQuestionChain: async (value: LocalQuestionChain): Promise<void> => {
    await readerDb.questionChains.put({ ...value, updated_at: now() }); changed()
  },
  deleteQuestionChain: async (id: string): Promise<void> => { await readerDb.questionChains.delete(id); changed() },
  saveQuestionDraft: async (value: QuestionDraft): Promise<void> => {
    await readerDb.transaction('rw', readerDb.questionDrafts, async () => {
      if (value.status === 'editing' || value.status === 'awaiting-import') {
        const pending = await readerDb.questionDrafts.where('chain_id').equals(value.chain_id).filter(
          (entry) => entry.draft_id !== value.draft_id && (entry.status === 'editing' || entry.status === 'awaiting-import'),
        ).first()
        if (pending) throw new Error(`Question chain ${value.chain_id} already has a pending draft`)
      }
      await readerDb.questionDrafts.put({ ...value, updated_at: now() })
    })
    changed()
  },
  deleteQuestionDraft: async (id: string): Promise<void> => { await readerDb.questionDrafts.delete(id); changed() },
  savePendingRemoval: async (value: PendingRemoval): Promise<void> => {
    await readerDb.pendingRemovals.put({ ...value, updated_at: now() }); changed()
  },
  deletePendingRemoval: async (id: string): Promise<void> => { await readerDb.pendingRemovals.delete(id); changed() },
  saveOpinion: async (value: Opinion): Promise<void> => {
    await readerDb.opinions.put({ ...value, updated_at: now() }); changed()
  },
  deleteOpinion: async (id: string): Promise<void> => { await readerDb.opinions.delete(id); changed() },
}
