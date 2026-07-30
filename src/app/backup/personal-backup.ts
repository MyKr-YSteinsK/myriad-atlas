import Ajv2020 from 'ajv/dist/2020.js'
import backupSchema from '../../../schemas/backup/personal-backup-v1.schema.json'
import { APP_VERSION } from '../../lib/content-version'
import { localState } from '../state/local-state'
import { DATABASE_VERSION, readerDb, type AppMetaRecord, type LocalQuestionChain, type NodeState, type Opinion, type PendingRemoval, type QuestionDraft, type ReaderSettingsRecord, type RoutePosition } from '../state/reader-db'

export const PERSONAL_BACKUP_FORMAT = 'myriad-atlas-personal-backup' as const
export interface PersonalBackupV1 {
  format: typeof PERSONAL_BACKUP_FORMAT
  data_format_version: 1
  exported_at: string
  app_version: string
  knowledge_version: string
  database_version: typeof DATABASE_VERSION
  data: {
    settings: ReaderSettingsRecord[]
    node_states: NodeState[]
    route_positions: RoutePosition[]
    question_chains: LocalQuestionChain[]
    question_drafts: QuestionDraft[]
    pending_removals: PendingRemoval[]
    opinions: Opinion[]
    app_preferences: AppMetaRecord[]
  }
}

export interface BackupReminderState {
  enabled: boolean
  due: boolean
  hasPersonalData: boolean
  lastSuccessAt?: string
  mutationCount: number
}

const backupPreferenceKeys = new Set<AppMetaRecord['key']>(['backup.preferences', 'install.guidance'])
const validator = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(backupSchema as object)

function byKey<T extends object>(key: keyof T): (left: T, right: T) => number {
  return (left, right) => String(left[key]).localeCompare(String(right[key]))
}

function containsUnsafeKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnsafeKey)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) => key === '__proto__' || key === 'prototype' || key === 'constructor' || containsUnsafeKey(child))
}

export async function createPersonalBackup(knowledgeVersion: string, exportedAt = new Date().toISOString(), appVersion = APP_VERSION): Promise<PersonalBackupV1> {
  const snapshot = await readerDb.transaction('r', [readerDb.settings, readerDb.nodeStates, readerDb.routePositions, readerDb.questionChains, readerDb.questionDrafts, readerDb.pendingRemovals, readerDb.opinions, readerDb.appMeta], async () => ({
    settings: await readerDb.settings.toArray(), nodeStates: await readerDb.nodeStates.toArray(), routePositions: await readerDb.routePositions.toArray(),
    questionChains: await readerDb.questionChains.toArray(), questionDrafts: await readerDb.questionDrafts.toArray(), pendingRemovals: await readerDb.pendingRemovals.toArray(),
    opinions: await readerDb.opinions.toArray(), appMeta: await readerDb.appMeta.toArray(),
  })) as { settings: ReaderSettingsRecord[]; nodeStates: NodeState[]; routePositions: RoutePosition[]; questionChains: LocalQuestionChain[]; questionDrafts: QuestionDraft[]; pendingRemovals: PendingRemoval[]; opinions: Opinion[]; appMeta: AppMetaRecord[] }
  return {
    format: PERSONAL_BACKUP_FORMAT, data_format_version: 1, exported_at: exportedAt, app_version: appVersion, knowledge_version: knowledgeVersion, database_version: DATABASE_VERSION,
    data: {
      settings: snapshot.settings.sort(byKey('key')),
      node_states: snapshot.nodeStates.sort(byKey('node_id')),
      route_positions: snapshot.routePositions.sort(byKey('route_id')),
      question_chains: snapshot.questionChains.sort(byKey('chain_id')),
      question_drafts: snapshot.questionDrafts.sort(byKey('draft_id')),
      pending_removals: snapshot.pendingRemovals.sort(byKey('id')),
      opinions: snapshot.opinions.sort(byKey('id')),
      app_preferences: snapshot.appMeta.filter((entry) => backupPreferenceKeys.has(entry.key)).sort(byKey('key')),
    },
  }
}

export function validatePersonalBackup(value: unknown): value is PersonalBackupV1 {
  if (containsUnsafeKey(value)) return false
  return Boolean(validator(value))
}

export function backupValidationMessage(): string {
  return validator.errors?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`).join('; ') ?? '备份结构无效。'
}

export function backupFileName(timestamp = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `myriad-atlas-backup-${timestamp.getFullYear()}-${pad(timestamp.getMonth() + 1)}-${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}${pad(timestamp.getSeconds())}.json`
}

export function backupJson(backup: PersonalBackupV1): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}

export interface BackupExportEnvironment {
  share?: (data: ShareData) => Promise<void>
  canShare?: (data: ShareData) => boolean
  createObjectURL?: (blob: Blob) => string
  revokeObjectURL?: (url: string) => void
  triggerDownload?: (url: string, fileName: string) => void
  createFile?: (parts: BlobPart[], name: string, options?: FilePropertyBag) => File
}

function defaultExportEnvironment(): BackupExportEnvironment {
  return {
    share: navigator.share?.bind(navigator), canShare: navigator.canShare?.bind(navigator), createObjectURL: URL.createObjectURL.bind(URL), revokeObjectURL: URL.revokeObjectURL.bind(URL),
    createFile: (parts, name, options) => new File(parts, name, options),
    triggerDownload: (url, fileName) => {
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = fileName; anchor.hidden = true
      document.body.append(anchor); anchor.click(); anchor.remove()
    },
  }
}

/** Starts an OS share or browser download. Cancellation is propagated and is not success. */
export async function startBackupExport(backup: PersonalBackupV1, environment: BackupExportEnvironment = defaultExportEnvironment()): Promise<'shared' | 'downloaded'> {
  const content = backupJson(backup)
  const name = backupFileName(new Date(backup.exported_at))
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  if (environment.share && environment.createFile) {
    const file = environment.createFile([blob], name, { type: blob.type })
    const shareData = { files: [file], title: '万象回廊 · MyKr 个人备份' }
    if (!environment.canShare || environment.canShare(shareData)) {
      await environment.share(shareData)
      return 'shared'
    }
  }
  if (!environment.createObjectURL || !environment.triggerDownload) throw new Error('当前浏览器无法启动备份导出。')
  const url = environment.createObjectURL(blob)
  try { environment.triggerDownload(url, name) } finally { setTimeout(() => environment.revokeObjectURL?.(url), 0) }
  return 'downloaded'
}

export async function exportPersonalBackup(knowledgeVersion: string, environment?: BackupExportEnvironment): Promise<{ backup: PersonalBackupV1; method: 'shared' | 'downloaded' }> {
  const backup = await createPersonalBackup(knowledgeVersion)
  const method = await startBackupExport(backup, environment)
  await localState.markBackupSuccessful(backup.exported_at)
  return { backup, method }
}

function backupHasPersonalData(backup: PersonalBackupV1): boolean {
  const { settings, node_states, route_positions, question_chains, question_drafts, pending_removals, opinions } = backup.data
  return settings.length + node_states.length + route_positions.length + question_chains.length + question_drafts.length + pending_removals.length + opinions.length > 0
}

export async function getBackupReminderState(knowledgeVersion: string, now = new Date()): Promise<BackupReminderState> {
  const [backup, preferences, lastSuccessAt, mutationCount] = await Promise.all([
    createPersonalBackup(knowledgeVersion, now.toISOString()), localState.getAppMeta<unknown>('backup.preferences'), localState.getAppMeta<unknown>('backup.last-success'), localState.getMutationCount(),
  ])
  const enabled = !preferences || typeof preferences !== 'object' || !('enabled' in preferences) || preferences.enabled !== false
  const last = typeof lastSuccessAt === 'string' && Number.isFinite(Date.parse(lastSuccessAt)) ? lastSuccessAt : undefined
  const overdue = !last || now.getTime() - Date.parse(last) > 14 * 24 * 60 * 60 * 1000
  const hasPersonalData = backupHasPersonalData(backup)
  return { enabled, due: enabled && hasPersonalData && (overdue || mutationCount >= 50), hasPersonalData, lastSuccessAt: last, mutationCount }
}

export async function setBackupReminderEnabled(enabled: boolean): Promise<void> {
  await localState.saveAppPreference('backup.preferences', { enabled })
}
