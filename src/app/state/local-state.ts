import type { Table } from 'dexie'
import { readerDb, saveReadingProgress, type AppMetaKey, type LocalQuestionChain, type NodeState, type OfflineFile, type OfflineJob, type Opinion, type PendingRemoval, type QuestionDraft, type ReaderPreferences, type RoutePosition } from './reader-db'

const listeners = new Set<() => void>()
let revision = 0
function changed(): void {
  revision += 1
  for (const listener of listeners) listener()
}
function now(): string { return new Date().toISOString() }
async function incrementMutationCount(): Promise<void> {
  const previous = await readerDb.appMeta.get('backup.mutation-count')
  const current = typeof previous?.value === 'number' && Number.isSafeInteger(previous.value) && previous.value >= 0 ? previous.value : 0
  await readerDb.appMeta.put({ key: 'backup.mutation-count', value: current + 1, updated_at: now() })
}
async function mutatePersonalState<T>(tables: Table[], operation: () => Promise<T>): Promise<T> {
  const result = await readerDb.transaction('rw', [readerDb.appMeta, ...tables], async () => {
    const value = await operation()
    await incrementMutationCount()
    return value
  })
  changed()
  return result
}
function emptyNodeState(nodeId: string): NodeState {
  return {
    node_id: nodeId, completed: false, completed_at: null, favorite: false, favorite_at: null,
    unknown: false, unknown_note: '', unknown_updated_at: null, uninterested: false,
    uninterested_note: '', uninterested_at: null, reading_progress: null, updated_at: now(),
  }
}

async function updateNode(nodeId: string, update: (value: NodeState, timestamp: string) => void): Promise<NodeState> {
  return mutatePersonalState([readerDb.nodeStates], async () => {
    const value = await readerDb.nodeStates.get(nodeId) ?? emptyNodeState(nodeId)
    const timestamp = now()
    update(value, timestamp)
    value.updated_at = timestamp
    await readerDb.nodeStates.put(value)
    return value
  })
}

export const localState = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getRevision: (): number => revision,
  getNode: (nodeId: string): Promise<NodeState | undefined> => readerDb.nodeStates.get(nodeId),
  listNodeStates: (): Promise<NodeState[]> => readerDb.nodeStates.toArray(),
  listRoutePositions: (): Promise<RoutePosition[]> => readerDb.routePositions.toArray(),
  listQuestionChains: (): Promise<LocalQuestionChain[]> => readerDb.questionChains.toArray(),
  listQuestionDrafts: (): Promise<QuestionDraft[]> => readerDb.questionDrafts.toArray(),
  listPendingRemovals: (): Promise<PendingRemoval[]> => readerDb.pendingRemovals.toArray(),
  listOpinions: (): Promise<Opinion[]> => readerDb.opinions.toArray(),
  listOfflineJobs: (): Promise<OfflineJob[]> => readerDb.offlineJobs.toArray(),
  getOfflineJob: (jobId: string): Promise<OfflineJob | undefined> => readerDb.offlineJobs.get(jobId),
  listOfflineFiles: (jobId: string): Promise<OfflineFile[]> => readerDb.offlineFiles.where('job_id').equals(jobId).toArray(),
  getAppMeta: async <T>(key: AppMetaKey): Promise<T | undefined> => (await readerDb.appMeta.get(key))?.value as T | undefined,
  getMutationCount: async (): Promise<number> => {
    const value = await localState.getAppMeta<unknown>('backup.mutation-count')
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
  },
  saveReaderPreferences: async (value: ReaderPreferences): Promise<void> => {
    await mutatePersonalState([readerDb.settings], async () => {
      await readerDb.settings.put({ key: 'reader.preferences', value, updated_at: now(), schema_version: 1 })
    })
  },
  saveAppPreference: async (key: Exclude<AppMetaKey, 'backup.mutation-count' | 'offline.active' | 'offline.last-check'>, value: unknown): Promise<void> => {
    await mutatePersonalState([readerDb.appMeta], async () => {
      await readerDb.appMeta.put({ key, value, updated_at: now() })
    })
  },
  mirrorAppMeta: async (key: 'offline.active' | 'offline.last-check', value: unknown): Promise<void> => {
    await readerDb.appMeta.put({ key, value, updated_at: now() })
    changed()
  },
  saveOfflineJob: async (job: OfflineJob): Promise<void> => { await readerDb.offlineJobs.put(job); changed() },
  saveOfflineFile: async (file: OfflineFile): Promise<void> => { await readerDb.offlineFiles.put(file); changed() },
  saveOfflineFiles: async (files: OfflineFile[]): Promise<void> => { await readerDb.offlineFiles.bulkPut(files); changed() },
  deleteNodeState: async (nodeId: string): Promise<void> => {
    await mutatePersonalState([readerDb.nodeStates], () => readerDb.nodeStates.delete(nodeId))
  },
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
  markRoamingUninterested: async (nodeId: string, note: string): Promise<void> => {
    await mutatePersonalState([readerDb.nodeStates, readerDb.pendingRemovals], async () => {
      const value = await readerDb.nodeStates.get(nodeId) ?? emptyNodeState(nodeId)
      const timestamp = now()
      value.uninterested = true
      value.uninterested_note = note.trim()
      value.uninterested_at = timestamp
      value.updated_at = timestamp
      await readerDb.nodeStates.put(value)
      await readerDb.pendingRemovals.put({
        id: `roaming-node:${nodeId}`, kind: 'roaming-node', target_id: nodeId, root_node_id: null,
        note: note.trim(), created_at: timestamp, updated_at: timestamp,
      })
    })
  },
  undoRoamingUninterested: async (nodeId: string): Promise<void> => {
    await mutatePersonalState([readerDb.nodeStates, readerDb.pendingRemovals], async () => {
      const value = await readerDb.nodeStates.get(nodeId)
      if (value) {
        value.uninterested = false; value.uninterested_note = ''; value.uninterested_at = null; value.updated_at = now()
        await readerDb.nodeStates.put(value)
      }
      await readerDb.pendingRemovals.delete(`roaming-node:${nodeId}`)
    })
  },
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
    await mutatePersonalState([readerDb.questionChains], () => readerDb.questionChains.put({ ...value, updated_at: now() }))
  },
  deleteQuestionChain: async (id: string): Promise<void> => {
    await mutatePersonalState([readerDb.questionChains], () => readerDb.questionChains.delete(id))
  },
  createQuestionChain: async (chain: LocalQuestionChain, draft: QuestionDraft): Promise<void> => {
    await mutatePersonalState([readerDb.questionChains, readerDb.questionDrafts], async () => {
      if (await readerDb.questionChains.get(chain.chain_id)) throw new Error(`Question chain ${chain.chain_id} already exists`)
      await readerDb.questionChains.add(chain)
      await readerDb.questionDrafts.add(draft)
    })
  },
  createUnknownQuestionChain: async (nodeId: string, note: string, chain: LocalQuestionChain, draft: QuestionDraft): Promise<void> => {
    await mutatePersonalState([readerDb.nodeStates, readerDb.questionChains, readerDb.questionDrafts], async () => {
      if (await readerDb.questionChains.get(chain.chain_id)) throw new Error(`Question chain ${chain.chain_id} already exists`)
      const timestamp = now()
      const node = await readerDb.nodeStates.get(nodeId) ?? emptyNodeState(nodeId)
      node.unknown = true
      node.unknown_note = note.trim()
      node.unknown_updated_at = timestamp
      node.updated_at = timestamp
      await readerDb.nodeStates.put(node)
      await readerDb.questionChains.add(chain)
      await readerDb.questionDrafts.add(draft)
    })
  },
  updateQuestionBinding: async (chain: LocalQuestionChain, draft: QuestionDraft): Promise<void> => {
    await mutatePersonalState([readerDb.questionChains, readerDb.questionDrafts], async () => {
      await readerDb.questionChains.put(chain)
      await readerDb.questionDrafts.put(draft)
    })
  },
  saveFollowUp: async (chain: LocalQuestionChain, draft: QuestionDraft, unknown?: { node_id: string; note: string }): Promise<void> => {
    const tables = unknown ? [readerDb.questionChains, readerDb.questionDrafts, readerDb.nodeStates] : [readerDb.questionChains, readerDb.questionDrafts]
    await mutatePersonalState(tables, async () => {
      if (unknown) {
        const node = await readerDb.nodeStates.get(unknown.node_id) ?? emptyNodeState(unknown.node_id)
        const timestamp = now()
        node.unknown = true
        node.unknown_note = unknown.note.trim()
        node.unknown_updated_at = timestamp
        node.updated_at = timestamp
        await readerDb.nodeStates.put(node)
      }
      await readerDb.questionDrafts.put(draft)
      await readerDb.questionChains.put(chain)
    })
  },
  hideQuestionChain: async (chainId: string, rootNodeId: string): Promise<void> => {
    await mutatePersonalState([readerDb.questionChains, readerDb.pendingRemovals], async () => {
      const chain = await readerDb.questionChains.get(chainId)
      if (!chain) throw new Error(`Question chain ${chainId} is missing`)
      const timestamp = now()
      await readerDb.questionChains.put({ ...chain, status: 'hidden', updated_at: timestamp })
      await readerDb.pendingRemovals.put({
        id: `qa-chain:${chainId}`, kind: 'qa-chain', target_id: chainId, root_node_id: rootNodeId,
        note: '', previous_status: chain.status === 'hidden' ? undefined : chain.status, created_at: timestamp, updated_at: timestamp,
      })
    })
  },
  undoHiddenQuestionChain: async (chainId: string): Promise<void> => {
    await mutatePersonalState([readerDb.questionChains, readerDb.questionDrafts, readerDb.pendingRemovals], async () => {
      const chain = await readerDb.questionChains.get(chainId)
      const removal = await readerDb.pendingRemovals.get(`qa-chain:${chainId}`)
      if (!chain || !removal) throw new Error(`Question chain ${chainId} cannot be restored`)
      const pendingDraft = await readerDb.questionDrafts.where('chain_id').equals(chainId).filter(
        (draft) => draft.status === 'editing' || draft.status === 'awaiting-import',
      ).first()
      const resolvedDraft = await readerDb.questionDrafts.where('chain_id').equals(chainId).filter(
        (draft) => draft.status === 'resolved',
      ).first()
      const status = removal.previous_status ?? (pendingDraft ? 'awaiting-import' : resolvedDraft ? 'answered' : undefined)
      if (!status) throw new Error(`Question chain ${chainId} has no reliable previous status`)
      await readerDb.questionChains.put({ ...chain, status, updated_at: now() })
      await readerDb.pendingRemovals.delete(`qa-chain:${chainId}`)
    })
  },
  hideQaDescendants: async (chainId: string, fromNodeId: string, rootNodeId: string): Promise<void> => {
    const timestamp = now()
    await mutatePersonalState([readerDb.pendingRemovals], () => readerDb.pendingRemovals.put({
      id: `qa-descendants:${chainId}:${fromNodeId}`, kind: 'qa-descendants', target_id: fromNodeId,
      root_node_id: rootNodeId, note: '', created_at: timestamp, updated_at: timestamp,
    }))
  },
  saveQuestionDraft: async (value: QuestionDraft): Promise<void> => {
    await mutatePersonalState([readerDb.questionDrafts], async () => {
      if (value.status === 'editing' || value.status === 'awaiting-import') {
        const pending = await readerDb.questionDrafts.where('chain_id').equals(value.chain_id).filter(
          (entry) => entry.draft_id !== value.draft_id && (entry.status === 'editing' || entry.status === 'awaiting-import'),
        ).first()
        if (pending) throw new Error(`Question chain ${value.chain_id} already has a pending draft`)
      }
      await readerDb.questionDrafts.put({ ...value, updated_at: now() })
    })
  },
  deleteQuestionDraft: async (id: string): Promise<void> => {
    await mutatePersonalState([readerDb.questionDrafts], () => readerDb.questionDrafts.delete(id))
  },
  savePendingRemoval: async (value: PendingRemoval): Promise<void> => {
    await mutatePersonalState([readerDb.pendingRemovals], () => readerDb.pendingRemovals.put({ ...value, updated_at: now() }))
  },
  deletePendingRemoval: async (id: string): Promise<void> => {
    await mutatePersonalState([readerDb.pendingRemovals], () => readerDb.pendingRemovals.delete(id))
  },
  saveOpinion: async (value: Opinion): Promise<void> => {
    await mutatePersonalState([readerDb.opinions], () => readerDb.opinions.put({ ...value, updated_at: now() }))
  },
  deleteOpinion: async (id: string): Promise<void> => {
    await mutatePersonalState([readerDb.opinions], () => readerDb.opinions.delete(id))
  },
}
