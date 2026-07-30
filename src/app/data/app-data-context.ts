import { createContext, useContext } from 'react'
import type { RuntimeAppChangelog, RuntimeCatalog, RuntimeContentManifest, RuntimeKnowledgeChangelog, RuntimeQaIndex, RuntimeRoutesIndex, RuntimeTaxonomy } from '../../content/types'
import type { ContentRepository } from '../../lib/content-client'
import type { ContentClientError } from '../../lib/errors'

export interface AppData {
  catalog: RuntimeCatalog
  taxonomy: RuntimeTaxonomy
  routes: RuntimeRoutesIndex
  qaIndex: RuntimeQaIndex
  manifest: RuntimeContentManifest
  appChangelog: RuntimeAppChangelog
  knowledgeChangelog: RuntimeKnowledgeChangelog
  contentVersion: string
}
export type AppDataState =
  | { status: 'loading' }
  | { status: 'ready' | 'empty'; data: AppData; refreshing?: boolean; refreshError?: ContentClientError }
  | { status: 'error'; error: ContentClientError }

export const AppDataContext = createContext<{ state: AppDataState; repository: ContentRepository; refresh: () => Promise<void> } | undefined>(undefined)

export function useAppData() {
  const value = useContext(AppDataContext)
  if (!value) throw new Error('useAppData must be used inside AppDataProvider')
  return value
}

export function useOptionalAppData() {
  return useContext(AppDataContext)
}
