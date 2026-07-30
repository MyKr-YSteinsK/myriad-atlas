import { useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { AppUpdateController, type AppUpdateState } from './app-updates'
import { APP_VERSION } from '../lib/content-version'
import { AppUpdateContext } from './app-update-context'

export function AppUpdateProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AppUpdateState>({ status: 'unsupported', appVersion: APP_VERSION })
  const [controller] = useState(() => new AppUpdateController({ onStateChange: setState }))
  useEffect(() => {
    controller.start()
    return () => controller.dispose()
  }, [controller])
  const value = useMemo(() => ({
    state,
    activateUpdate: () => controller.activateUpdate(),
    ignoreUpdate: () => controller.ignoreUpdate(),
    registerFlush: (flush: () => Promise<void>) => controller.registerFlush(flush),
  }), [controller, state])
  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>
}
