import { createContext, useContext, useEffect } from 'react'
import { APP_VERSION } from '../lib/content-version'
import type { AppUpdateState } from './app-updates'

export interface AppUpdateContextValue {
  state: AppUpdateState
  activateUpdate: () => Promise<boolean>
  ignoreUpdate: () => void
  registerFlush: (flush: () => Promise<void>) => () => void
}

export const AppUpdateContext = createContext<AppUpdateContextValue | undefined>(undefined)

const unsupportedUpdateContext: AppUpdateContextValue = {
  state: { status: 'unsupported', lifecycle: 'idle', appVersion: APP_VERSION },
  activateUpdate: async () => false,
  ignoreUpdate: () => undefined,
  registerFlush: () => () => undefined,
}

export function useAppUpdate(): AppUpdateContextValue {
  return useContext(AppUpdateContext) ?? unsupportedUpdateContext
}

export function useUpdateFlush(flush: () => Promise<void>): void {
  const value = useContext(AppUpdateContext)
  useEffect(() => value?.registerFlush(flush), [flush, value])
}
