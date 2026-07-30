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
export type OfflineJobStatus = 'estimating' | 'downloading' | 'paused' | 'failed' | 'verifying' | 'ready-to-activate' | 'activating' | 'active' | 'rollback-failed'
export interface OfflineJob {
  job_id: string
  content_version: string
  manifest_fingerprint: string
  cache_name: string
  status: OfflineJobStatus
  /** Actual manifest plus content payload; use these fields for progress. */
  payload_bytes_total: number
  payload_bytes_done: number
  /** Payload plus a separate recommended safety margin for Cache Storage. */
  required_storage_bytes: number
  /** @deprecated v3 compatibility fields. They mirror payload byte progress. */
  bytes_total: number
  bytes_done: number
  files_total: number
  files_done: number
  current_path: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}
export interface OfflineFile {
  job_id: string
  path: string
  kind: string
  bytes: number
  sha256: string
  status: 'pending' | 'downloading' | 'complete' | 'failed'
  attempts: number
  error_message: string | null
  updated_at: string
}
export type AppMetaKey = 'offline.active' | 'offline.last-check' | 'backup.preferences' | 'backup.last-success' | 'backup.mutation-count' | 'install.guidance'
export interface AppMetaRecord { key: AppMetaKey; value: unknown; updated_at: string }

export const DATABASE_VERSION = 4

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

function validBytes(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

/** Keeps interrupted v3 jobs readable without discarding their staged cache. */
export function normalizeOfflineJob(value: OfflineJob): OfflineJob {
  const legacyTotal = validBytes(value.bytes_total)
  const payloadTotal = validBytes(value.payload_bytes_total, legacyTotal)
  const legacyDone = validBytes(value.bytes_done)
  const payloadDone = Math.min(payloadTotal, validBytes(value.payload_bytes_done, legacyDone))
  return {
    ...value,
    payload_bytes_total: payloadTotal,
    payload_bytes_done: payloadDone,
    required_storage_bytes: Math.max(payloadTotal, validBytes(value.required_storage_bytes, payloadTotal)),
    bytes_total: payloadTotal,
    bytes_done: payloadDone,
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
  offlineJobs!: Table<OfflineJob, string>
  offlineFiles!: Table<OfflineFile, [string, string]>
  appMeta!: Table<AppMetaRecord, AppMetaKey>

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
    this.version(3).stores({
      settings: '&key',
      nodeStates: '&node_id, completed, favorite, unknown, uninterested, updated_at',
      routePositions: '&route_id, updated_at',
      questionChains: '&chain_id, root_node_id, status, updated_at',
      questionDrafts: '&draft_id, chain_id, status, updated_at',
      pendingRemovals: '&id, kind, target_id, updated_at',
      opinions: '&id, scope, route_id, updated_at',
      offlineJobs: '&job_id, [content_version+manifest_fingerprint], status, updated_at',
      offlineFiles: '[job_id+path], job_id, status, updated_at',
      appMeta: '&key, updated_at',
    }).upgrade(async (transaction) => {
      await transaction.table<PendingRemoval, string>('pendingRemovals').toCollection().modify((record) => {
        if (record.previous_status && !['draft', 'awaiting-import', 'answered', 'id-conflict'].includes(record.previous_status)) delete record.previous_status
      })
    })
    this.version(DATABASE_VERSION).stores({
      settings: '&key',
      nodeStates: '&node_id, completed, favorite, unknown, uninterested, updated_at',
      routePositions: '&route_id, updated_at',
      questionChains: '&chain_id, root_node_id, status, updated_at',
      questionDrafts: '&draft_id, chain_id, status, updated_at',
      pendingRemovals: '&id, kind, target_id, updated_at',
      opinions: '&id, scope, route_id, updated_at',
      offlineJobs: '&job_id, [content_version+manifest_fingerprint], status, updated_at',
      offlineFiles: '[job_id+path], job_id, status, updated_at',
      appMeta: '&key, updated_at',
    }).upgrade(async (transaction) => {
      await transaction.table<OfflineJob, string>('offlineJobs').toCollection().modify((record) => {
        Object.assign(record, normalizeOfflineJob(record))
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

export async function normalizeInterruptedOfflineJobs(database = readerDb): Promise<void> {
  const timestamp = new Date().toISOString()
  await database.transaction('rw', database.offlineJobs, database.offlineFiles, async () => {
    await database.offlineJobs.toCollection().modify((record) => { Object.assign(record, normalizeOfflineJob(record)) })
    await database.offlineJobs.where('status').equals('downloading').modify({
      status: 'paused', error_code: 'interrupted', error_message: '下载在上次关闭时中断。', current_path: null, updated_at: timestamp,
    })
    await database.offlineFiles.where('status').equals('downloading').modify({ status: 'pending', updated_at: timestamp })
  })
}
