import Ajv2020 from 'ajv/dist/2020.js'
import backupSchema from '../../../schemas/backup/personal-backup-v1.schema.json'
import { APP_VERSION } from '../../lib/content-version'
import { compareContentVersions, parseContentVersion } from '../../lib/content-version'
import { localState, type PersonalStateReplacement } from '../state/local-state'
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

export interface RestoreContext {
  appVersion: string
  knowledgeVersion: string
  nodeIds: Iterable<string>
  routeIds: Iterable<string>
  tocIdsByNode?: ReadonlyMap<string, ReadonlySet<string>>
}

export interface RestoreSummary {
  replaced: number
  imported: number
  skipped: Record<string, number>
  warnings: string[]
}

export interface PreparedRestore {
  backup: PersonalBackupV1
  data: PersonalStateReplacement
  summary: RestoreSummary
}

function increment(target: Record<string, number>, reason: string): void { target[reason] = (target[reason] ?? 0) + 1 }
function clamp(value: number, low: number, high: number, fallback: number): number { return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback }
function normalizeSettings(record: ReaderSettingsRecord): ReaderSettingsRecord {
  const value = record.value
  return {
    ...record,
    value: {
      ...value,
      fontSize: clamp(value.fontSize, 10, 40, 18), lineHeight: clamp(value.lineHeight, 1.1, 3, 1.75), paragraphSpacing: clamp(value.paragraphSpacing, 0, 4, 0.85),
      gutter: clamp(value.gutter, 0, 80, 20), contentWidth: clamp(value.contentWidth, 280, 1400, 720),
    },
  }
}

function isHigherAppVersion(candidate: string, current: string): boolean {
  const parse = (value: string): number[] | undefined => /^\d+(?:\.\d+){1,2}$/.test(value) ? value.split('.').map(Number) : undefined
  const left = parse(candidate); const right = parse(current)
  if (!left || !right) return false
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0)
  }
  return false
}

export function preparePersonalRestore(backup: PersonalBackupV1, context: RestoreContext): PreparedRestore {
  if (!validatePersonalBackup(backup)) throw new Error(backupValidationMessage())
  if (backup.data_format_version > 1) throw new Error('备份数据格式较新，请先更新应用。')
  if (!parseContentVersion(backup.knowledge_version) || !parseContentVersion(context.knowledgeVersion)) throw new Error('备份或当前知识版本无效，不能恢复。')
  if (compareContentVersions(context.knowledgeVersion, backup.knowledge_version) === 'older') throw new Error('备份所需知识版本较新，请先更新知识。')
  const nodeIds = new Set(context.nodeIds)
  const routeIds = new Set(context.routeIds)
  const skipped: Record<string, number> = {}
  const warnings: string[] = []
  if (isHigherAppVersion(backup.app_version, context.appVersion)) warnings.push('备份来自较新的应用版本；数据格式兼容后将继续恢复。')

  const nodeStates: NodeState[] = []
  for (const state of backup.data.node_states) {
    if (!nodeIds.has(state.node_id)) { increment(skipped, 'missing-node-state'); continue }
    const toc = context.tocIdsByNode?.get(state.node_id)
    nodeStates.push({ ...state, reading_progress: state.reading_progress && toc && !toc.has(state.reading_progress.anchor) ? { ...state.reading_progress, anchor: '' } : state.reading_progress })
  }
  const routePositions: RoutePosition[] = []
  for (const position of backup.data.route_positions) {
    if (!routeIds.has(position.route_id)) { increment(skipped, 'missing-route-position'); continue }
    routePositions.push(position)
  }
  const duplicateChains = new Set<string>()
  const seenChains = new Set<string>()
  for (const chain of backup.data.question_chains) {
    if (seenChains.has(chain.chain_id)) duplicateChains.add(chain.chain_id)
    seenChains.add(chain.chain_id)
  }
  const duplicateDrafts = new Set<string>()
  const seenDrafts = new Set<string>()
  for (const draft of backup.data.question_drafts) {
    if (seenDrafts.has(draft.draft_id)) duplicateDrafts.add(draft.draft_id)
    seenDrafts.add(draft.draft_id)
  }
  const chainsById = new Map(backup.data.question_chains.map((chain) => [chain.chain_id, chain]))
  const invalidChains = new Set<string>(duplicateChains)
  const pendingPerChain = new Map<string, number>()
  for (const draft of backup.data.question_drafts) {
    const chain = chainsById.get(draft.chain_id)
    if (!chain || chain.root_node_id !== draft.root_node_id || duplicateDrafts.has(draft.draft_id)) invalidChains.add(draft.chain_id)
    if (draft.status === 'editing' || draft.status === 'awaiting-import') pendingPerChain.set(draft.chain_id, (pendingPerChain.get(draft.chain_id) ?? 0) + 1)
  }
  for (const [chainId, count] of pendingPerChain) if (count > 1) invalidChains.add(chainId)
  const questionChains: LocalQuestionChain[] = []
  for (const chain of backup.data.question_chains) {
    if (!nodeIds.has(chain.root_node_id)) { invalidChains.add(chain.chain_id); increment(skipped, 'missing-question-root'); continue }
    if (invalidChains.has(chain.chain_id)) { increment(skipped, 'invalid-question-chain'); continue }
    questionChains.push(chain)
  }
  const acceptedChainIds = new Set(questionChains.map((chain) => chain.chain_id))
  const questionDrafts: QuestionDraft[] = []
  for (const draft of backup.data.question_drafts) {
    if (!acceptedChainIds.has(draft.chain_id) || duplicateDrafts.has(draft.draft_id)) { increment(skipped, 'invalid-question-draft'); continue }
    questionDrafts.push(draft)
  }
  const pendingRemovals: PendingRemoval[] = []
  for (const removal of backup.data.pending_removals) {
    const valid = removal.kind === 'roaming-node' ? nodeIds.has(removal.target_id)
      : removal.kind === 'qa-chain' ? acceptedChainIds.has(removal.target_id)
        : Boolean(removal.root_node_id && nodeIds.has(removal.root_node_id))
    if (!valid) { increment(skipped, 'missing-pending-target'); continue }
    pendingRemovals.push(removal)
  }
  const settings = backup.data.settings.map(normalizeSettings)
  const data: PersonalStateReplacement = {
    settings, node_states: nodeStates, route_positions: routePositions, question_chains: questionChains, question_drafts: questionDrafts,
    pending_removals: pendingRemovals, opinions: [...backup.data.opinions], app_preferences: [...backup.data.app_preferences],
  }
  const imported = settings.length + nodeStates.length + routePositions.length + questionChains.length + questionDrafts.length + pendingRemovals.length + data.opinions.length + data.app_preferences.length
  const replaced = backup.data.settings.length + backup.data.node_states.length + backup.data.route_positions.length + backup.data.question_chains.length + backup.data.question_drafts.length + backup.data.pending_removals.length + backup.data.opinions.length + backup.data.app_preferences.length
  return { backup, data, summary: { replaced, imported, skipped, warnings } }
}

export async function applyPersonalRestore(prepared: PreparedRestore): Promise<void> {
  await localState.replacePersonalData(prepared.data)
}

export async function clearAllPersonalData(): Promise<void> {
  await localState.clearPersonalData()
}

export async function readPersonalBackupFile(file: File, maxBytes = 15 * 1024 * 1024): Promise<PersonalBackupV1> {
  if (file.size > maxBytes) throw new Error('备份文件超过 15 MiB 限制。')
  let parsed: unknown
  try { parsed = JSON.parse(await file.text()) } catch (error) { throw new Error(`备份 JSON 无法解析：${error instanceof Error ? error.message : 'unknown error'}`, { cause: error }) }
  if (parsed && typeof parsed === 'object' && 'data_format_version' in parsed && typeof parsed.data_format_version === 'number' && parsed.data_format_version > 1) throw new Error('备份数据格式较新，请先更新应用。')
  if (!validatePersonalBackup(parsed)) throw new Error(backupValidationMessage())
  return parsed
}
