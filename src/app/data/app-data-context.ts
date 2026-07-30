import { createContext, useContext } from 'react'
import type { RuntimeCatalog, RuntimeQaIndex, RuntimeRoutesIndex, RuntimeTaxonomy } from '../../content/types'
import type { ContentRepository } from '../../lib/content-client'
import type { ContentClientError } from '../../lib/errors'

export interface AppData {
  catalog: RuntimeCatalog
  taxonomy: RuntimeTaxonomy
  routes: RuntimeRoutesIndex
  qaIndex: RuntimeQaIndex
  contentVersion: string
}
export type AppDataState =
  | { status: 'loading' }
  | { status: 'ready' | 'empty'; data: AppData }
  | { status: 'error'; error: ContentClientError }

export const AppDataContext = createContext<{ state: AppDataState; repository: ContentRepository } | undefined>(undefined)

export function useAppData() {
  const value = useContext(AppDataContext)
  if (!value) throw new Error('useAppData must be used inside AppDataProvider')
  return value
}
