import Dexie, { type Table } from 'dexie'

export type ReaderTheme = 'system' | 'light' | 'dark' | 'warm'
export type ReaderFont = 'system' | 'serif'
export interface ReaderPreferences {
  fontSize: number
  lineHeight: number
  paragraphSpacing: number
  gutter: number
  contentWidth: number
  font: ReaderFont
  theme: ReaderTheme
  showProgress: boolean
  showToc: boolean
  codeWrap: boolean
}
export interface ReaderSettingsRecord { key: 'reader.preferences'; value: ReaderPreferences; updated_at: string; schema_version: 1 }
export interface ReadingProgress { ratio: number; anchor: string; updated_at: string }
export interface NodeState {
  node_id: string
  completed: boolean
  completed_at: string | null
  favorite: boolean
  favorite_at: string | null
  unknown: boolean
  unknown_note: string
  unknown_updated_at: string | null
  uninterested: boolean
  uninterested_note: string
  uninterested_at: string | null
  reading_progress: ReadingProgress | null
  updated_at: string
}
export interface RoutePosition { route_id: string; stage_id: string; module_id: string; node_id: string; updated_at: string }
export interface LocalQuestionChain {
  chain_id: string
  root_node_id: string
  reserved_first_answer_id: string
  status: 'draft' | 'awaiting-import' | 'answered' | 'id-conflict' | 'hidden'
  created_at: string
  updated_at: string
}
export interface QuestionDraft {
  draft_id: string
  chain_id: string
  root_node_id: string
  parent_node_id: string | null
  question: string
  source_title: string
  source_domain_id: string
  source_domain_name: string
  source_course_id: string
  source_course_name: string
  source_path: string
  source_content_version: string
  status: 'editing' | 'awaiting-import' | 'resolved' | 'cancelled'
  copied_at: string | null
  created_at: string
  updated_at: string
}
export interface PendingRemoval {
  id: string
  kind: 'roaming-node' | 'qa-chain' | 'qa-descendants'
  target_id: string
  root_node_id: string | null
  note: string
  previous_status?: Exclude<LocalQuestionChain['status'], 'hidden'>
  created_at: string
  updated_at: string
}
export interface Opinion {
  id: string
  scope: 'global' | 'route'
  route_id: string | null
  text: string
  created_at: string
  updated_at: string
}

export const defaultReaderPreferences: ReaderPreferences = {
  fontSize: 18, lineHeight: 1.75, paragraphSpacing: 0.85, gutter: 20, contentWidth: 720,
  font: 'system', theme: 'system', showProgress: true, showToc: true, codeWrap: false,
}

function normalizeNodeState(value: Partial<NodeState> & { node_id: string }): NodeState {
  const now = value.updated_at || new Date().toISOString()
  return {
    node_id: value.node_id,
    completed: Boolean(value.completed),
    completed_at: value.completed_at ?? null,
    favorite: Boolean(value.favorite),
    favorite_at: value.favorite_at ?? null,
    unknown: Boolean(value.unknown),
    unknown_note: typeof value.unknown_note === 'string' ? value.unknown_note : '',
    unknown_updated_at: value.unknown_updated_at ?? null,
    uninterested: Boolean(value.uninterested),
    uninterested_note: typeof value.uninterested_note === 'string' ? value.uninterested_note : '',
    uninterested_at: value.uninterested_at ?? null,
    reading_progress: value.reading_progress ?? null,
    updated_at: now,
  }
}

export class MyriadAtlasDatabase extends Dexie {
  settings!: Table<ReaderSettingsRecord, string>
  nodeStates!: Table<NodeState, string>
  routePositions!: Table<RoutePosition, string>
  questionChains!: Table<LocalQuestionChain, string>
  questionDrafts!: Table<QuestionDraft, string>
  pendingRemovals!: Table<PendingRemoval, string>
  opinions!: Table<Opinion, string>

  constructor(name = 'myriad-atlas') {
    super(name)
    this.version(1).stores({ settings: '&key', nodeStates: '&node_id, updated_at' })
    this.version(2).stores({
      settings: '&key',
      nodeStates: '&node_id, completed, favorite, unknown, uninterested, updated_at',
      routePositions: '&route_id, updated_at',
      questionChains: '&chain_id, root_node_id, status, updated_at',
      questionDrafts: '&draft_id, chain_id, status, updated_at',
      pendingRemovals: '&id, kind, target_id, updated_at',
      opinions: '&id, scope, route_id, updated_at',
    }).upgrade(async (transaction) => {
      await transaction.table<NodeState, string>('nodeStates').toCollection().modify((record) => {
        Object.assign(record, normalizeNodeState(record))
      })
    })
  }
}

export const readerDb = new MyriadAtlasDatabase()

export async function loadReaderPreferences(): Promise<ReaderPreferences> {
  const saved = await readerDb.settings.get('reader.preferences')
  return saved?.value ? { ...defaultReaderPreferences, ...saved.value } : { ...defaultReaderPreferences }
}
export async function saveReaderPreferences(value: ReaderPreferences): Promise<void> {
  await readerDb.settings.put({ key: 'reader.preferences', value, updated_at: new Date().toISOString(), schema_version: 1 })
}
export async function saveReadingProgress(nodeId: string, ratio: number, anchor: string, tocIds: string[]): Promise<void> {
  const safeRatio = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0))
  const safeAnchor = tocIds.includes(anchor) ? anchor : ''
  const previous = await readerDb.nodeStates.get(nodeId)
  const now = new Date().toISOString()
  await readerDb.nodeStates.put(normalizeNodeState({
    ...previous,
    node_id: nodeId,
    reading_progress: { ratio: safeRatio, anchor: safeAnchor, updated_at: now },
    updated_at: now,
  }))
}
