import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultReaderPreferences, loadReaderPreferences, saveReaderPreferences, type ReaderPreferences } from '../state/reader-db'

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
    savesRef.current = savesRef.current.catch(() => undefined).then(async () => {
      try {
        await saveReaderPreferences(pending)
      } catch {
        reportFailure()
      }
    })
    await savesRef.current
  }, [reportFailure])
  const schedule = useCallback((next: ReaderPreferences) => {
    pendingRef.current = next
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { void flush() }, SAVE_DELAY_MS)
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
    const flushOnHidden = (): void => { if (document.visibilityState === 'hidden') void flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flushOnHidden)
    return () => {
      void flush()
      mountedRef.current = false
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flushOnHidden)
    }
  }, [flush])

  return { preferences, storageWarning, update, reset, flush }
}
