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
  reading_progress: ReadingProgress | null
  updated_at: string
}

export const defaultReaderPreferences: ReaderPreferences = {
  fontSize: 18,
  lineHeight: 1.75,
  paragraphSpacing: 0.85,
  gutter: 20,
  contentWidth: 720,
  font: 'system',
  theme: 'system',
  showProgress: true,
  showToc: true,
  codeWrap: false,
}

class MyriadAtlasDatabase extends Dexie {
  settings!: Table<ReaderSettingsRecord, string>
  nodeStates!: Table<NodeState, string>

  constructor() {
    super('myriad-atlas')
    this.version(1).stores({ settings: '&key', nodeStates: '&node_id, updated_at' })
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
  await readerDb.nodeStates.put({
    node_id: nodeId,
    completed: previous?.completed ?? false,
    completed_at: previous?.completed_at ?? null,
    favorite: previous?.favorite ?? false,
    favorite_at: previous?.favorite_at ?? null,
    unknown: previous?.unknown ?? false,
    unknown_note: previous?.unknown_note ?? '',
    unknown_updated_at: previous?.unknown_updated_at ?? null,
    reading_progress: { ratio: safeRatio, anchor: safeAnchor, updated_at: now },
    updated_at: now,
  })
}
