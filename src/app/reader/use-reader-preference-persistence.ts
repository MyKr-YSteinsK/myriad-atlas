import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultReaderPreferences, loadReaderPreferences, type ReaderPreferences } from '../state/reader-db'
import { localState } from '../state/local-state'

const SAVE_DELAY_MS = 250

export function useReaderPreferencePersistence() {
  const [preferences, setPreferences] = useState<ReaderPreferences>(defaultReaderPreferences)
  const [storageWarning, setStorageWarning] = useState(false)
  const preferencesRef = useRef(preferences)
  const pendingRef = useRef<ReaderPreferences | undefined>(undefined)
  const timerRef = useRef<number | undefined>(undefined)
  const mountedRef = useRef(true)
  const changedRef = useRef(false)
  const warnedRef = useRef(false)
  const savesRef = useRef(Promise.resolve())

  const reportFailure = useCallback(() => {
    if (warnedRef.current || !mountedRef.current) return
    warnedRef.current = true
    setStorageWarning(true)
  }, [])
  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = undefined
    savesRef.current = savesRef.current.catch(() => undefined).then(() => localState.saveReaderPreferences(pending)).catch((reason: unknown) => {
      reportFailure()
      throw reason
    })
    await savesRef.current
  }, [reportFailure])
  const schedule = useCallback((next: ReaderPreferences) => {
    pendingRef.current = next
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { void flush().catch(() => undefined) }, SAVE_DELAY_MS)
  }, [flush])
  const update = useCallback((patch: Partial<ReaderPreferences>) => {
    changedRef.current = true
    const next = { ...preferencesRef.current, ...patch }
    preferencesRef.current = next
    setPreferences(next)
    schedule(next)
  }, [schedule])
  const reset = useCallback(() => update(defaultReaderPreferences), [update])

  useEffect(() => {
    let active = true
    loadReaderPreferences().then((value) => {
      if (!active || changedRef.current) return
      preferencesRef.current = value
      setPreferences(value)
    }).catch(reportFailure)
    return () => { active = false }
  }, [reportFailure])
  useEffect(() => {
    const flushOnHidden = (): void => { if (document.visibilityState === 'hidden') void flush().catch(() => undefined) }
    const flushOnPageHide = (): void => { void flush().catch(() => undefined) }
    window.addEventListener('pagehide', flushOnPageHide)
    document.addEventListener('visibilitychange', flushOnHidden)
    return () => {
      void flush().catch(() => undefined)
      mountedRef.current = false
      window.removeEventListener('pagehide', flushOnPageHide)
      document.removeEventListener('visibilitychange', flushOnHidden)
    }
  }, [flush])

  return { preferences, storageWarning, update, reset, flush }
}
