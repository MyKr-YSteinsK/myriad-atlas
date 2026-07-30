import { useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { contentRepository, type ContentRepository } from '../../lib/content-client'
import { ContentClientError } from '../../lib/errors'
import { AppDataContext, type AppDataState } from './app-data-context'
import { reconcileQuestionChains } from './question-chains'

export function AppDataProvider({
  children,
  repository = contentRepository,
}: PropsWithChildren<{ repository?: ContentRepository }>) {
  const [state, setState] = useState<AppDataState>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    Promise.all([
      repository.loadCatalog(controller.signal),
      repository.loadTaxonomy(controller.signal),
      repository.loadRoutesIndex(controller.signal),
      repository.loadQaIndex(controller.signal),
    ]).then(([catalog, taxonomy, routes, qaIndex]) => {
      if (!active) return
      const data = { catalog, taxonomy, routes, qaIndex, contentVersion: catalog.content_version }
      setState({ status: catalog.nodes.length === 0 ? 'empty' : 'ready', data })
      void reconcileQuestionChains(qaIndex)
    }).catch((reason: unknown) => {
      if (!active || reason instanceof DOMException && reason.name === 'AbortError') return
      setState({
        status: 'error',
        error: reason instanceof ContentClientError ? reason : new ContentClientError('application', '应用数据无法加载。'),
      })
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [repository])
  const value = useMemo(() => ({ state, repository }), [repository, state])
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
