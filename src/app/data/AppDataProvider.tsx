import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { contentRepository, type ContentRepository } from '../../lib/content-client'
import { ContentClientError } from '../../lib/errors'
import { AppDataContext, type AppDataState } from './app-data-context'
import { loadAppData } from './app-data-loader'
import { reconcileQuestionChains } from './question-chains'

export function AppDataProvider({
  children,
  repository = contentRepository,
}: PropsWithChildren<{ repository?: ContentRepository }>) {
  const [state, setState] = useState<AppDataState>({ status: 'loading' })
  const stableState = useRef<Extract<AppDataState, { data: unknown }> | undefined>(undefined)
  const loadSequence = useRef(0)
  const activeController = useRef<AbortController | undefined>(undefined)
  const load = useCallback(async (refreshing: boolean): Promise<void> => {
    const sequence = ++loadSequence.current
    activeController.current?.abort()
    const previous = stableState.current
    if (refreshing && previous) setState({ ...previous, refreshing: true, refreshError: undefined })
    else setState({ status: 'loading' })
    const controller = new AbortController()
    activeController.current = controller
    try {
      const { catalog, taxonomy, routes, qaIndex, manifest, appChangelog, knowledgeChangelog } = refreshing
        ? await repository.reload(controller.signal)
        : await loadAppData(repository, controller.signal)
      if (sequence !== loadSequence.current) return
      const data = { catalog, taxonomy, routes, qaIndex, manifest, appChangelog, knowledgeChangelog, contentVersion: catalog.content_version }
      const next = { status: catalog.nodes.length === 0 ? 'empty' as const : 'ready' as const, data }
      stableState.current = next
      setState(next)
      void reconcileQuestionChains(qaIndex)
    } catch (reason: unknown) {
      if (sequence !== loadSequence.current || reason instanceof DOMException && reason.name === 'AbortError') return
      const error = reason instanceof ContentClientError ? reason : new ContentClientError('application', '应用数据无法加载。')
      if (previous) setState({ ...previous, refreshing: false, refreshError: error })
      else setState({ status: 'error', error })
    }
  }, [repository])
  useEffect(() => {
    void load(false)
    return () => {
      loadSequence.current += 1
      activeController.current?.abort()
    }
  }, [load])
  const refresh = useCallback(() => load(true), [load])
  const value = useMemo(() => ({ state, repository, refresh }), [refresh, repository, state])
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
