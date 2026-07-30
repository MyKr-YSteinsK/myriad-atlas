import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { SearchResult } from '../../lib/search-repository'
import { searchRepository } from '../../lib/search-repository'
import { useAppData } from '../data/app-data-context'
import { filterSearchResults } from '../data/search-results'
import { useLocalStateSnapshot } from '../state/use-local-state'

type SearchState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; results: SearchResult[]; skipped: number }
  | { status: 'error'; message: string }

export function SearchPage() {
  const { state: appState } = useAppData()
  const local = useLocalStateSnapshot()
  const [parameters, setParameters] = useSearchParams()
  const [query, setQuery] = useState(parameters.get('q') ?? '')
  const [domain, setDomain] = useState(parameters.get('domain') ?? '')
  const [course, setCourse] = useState(parameters.get('course') ?? '')
  const [kind, setKind] = useState(parameters.get('kind') ?? '')
  const [tag, setTag] = useState(parameters.get('tag') ?? '')
  const [availableFilters, setAvailableFilters] = useState<Record<string, Record<string, number>>>({})
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' })
  const input = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const ready = appState.status === 'ready' || appState.status === 'empty' ? appState.data : undefined
  const filters = useMemo(() => ({
    ...(domain ? { domain_id: domain } : {}),
    ...(course ? { course_id: course } : {}),
    ...(kind ? { kind } : {}),
    ...(tag ? { tags: tag } : {}),
  }), [course, domain, kind, tag])

  useEffect(() => {
    if (parameters.get('focus') === '1') input.current?.focus({ preventScroll: true })
  }, [parameters])
  useEffect(() => {
    const next = new URLSearchParams()
    if (query) next.set('q', query)
    if (domain) next.set('domain', domain)
    if (course) next.set('course', course)
    if (kind) next.set('kind', kind)
    if (tag) next.set('tag', tag)
    setParameters(next, { replace: true })
  }, [course, domain, kind, query, setParameters, tag])
  useEffect(() => {
    if (!ready || ready.catalog.nodes.length === 0 || !query.trim()) {
      return
    }
    const current = ++request.current
    void searchRepository.preload(query, filters).catch(() => undefined)
    const timer = window.setTimeout(() => {
      setSearchState({ status: 'loading' })
      searchRepository.search(query, filters).then((raw) => {
        if (current !== request.current) return
        setSearchState({ status: 'ready', ...filterSearchResults(raw, ready.catalog.nodes, local.nodeStates) })
      }).catch((error: unknown) => {
        if (current === request.current) setSearchState({ status: 'error', message: error instanceof Error ? error.message : '查询失败' })
      })
    }, 200)
    return () => {
      request.current += 1
      window.clearTimeout(timer)
    }
  }, [filters, local.nodeStates, query, ready])
  useEffect(() => {
    if (!ready || ready.catalog.nodes.length === 0) return
    searchRepository.filters().then(setAvailableFilters).catch(() => setAvailableFilters({}))
  }, [ready])

  if (!ready) return <section className="atlas-page"><h1 tabIndex={-1}>全文搜索</h1><p>{appState.status === 'error' ? appState.error.message : '正在加载搜索入口……'}</p></section>
  const stateById = new Map(local.nodeStates.map((entry) => [entry.node_id, entry]))
  const domains = ready.taxonomy.domains
  const courses = domain ? domains.find((entry) => entry.id === domain)?.courses ?? [] : domains.flatMap((entry) => entry.courses)
  return <section className="atlas-page search-page"><p className="atlas-coordinate">SEARCH / PAGEFIND</p><h1 tabIndex={-1}>全文搜索</h1>
    <label className="search-box">搜索正文、标题与要点<input ref={input} type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }} /></label>
    {ready.catalog.nodes.length === 0 ? <div className="atlas-empty"><span>00</span><p>内容库为空，尚无全文索引。<Link to="/library">前往知识库</Link></p></div> : <>
      <div className="search-filters"><label>领域<select value={domain} onChange={(event) => {
        const value = event.target.value
        setDomain(value)
        if (course && !domains.find((entry) => entry.id === value)?.courses.some((entry) => entry.id === course)) setCourse('')
      }}><option value="">全部</option>{domains.filter((entry) => !availableFilters.domain_id || entry.id in availableFilters.domain_id).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <label>课程<select value={course} onChange={(event) => setCourse(event.target.value)}><option value="">全部</option>{courses.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <label>类型<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">全部</option>{['normal', 'anchor', 'roaming', 'qa'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>标签<select value={tag} onChange={(event) => setTag(event.target.value)}><option value="">全部</option>{Object.keys(availableFilters.tags ?? {}).map((value) => <option key={value}>{value}</option>)}</select></label></div>
      {!query.trim() && <p className="search-guidance">输入一个词即可搜索正文；支持中文单字。</p>}
      {query.trim() && searchState.status === 'loading' && <p role="status">正在搜索……</p>}
      {query.trim() && searchState.status === 'error' && <p role="alert">{searchState.message}。可前往<Link to="/library">知识库浏览</Link>。</p>}
      {query.trim() && searchState.status === 'ready' && searchState.results.length === 0 && <p>没有匹配结果。</p>}
      {query.trim() && searchState.status === 'ready' && <ol className="search-results">{searchState.results.map((result) => {
        const nodeId = result.meta.node_id
        const record = ready.catalog.nodes.find((entry) => entry.id === nodeId)!
        const nodeState = stateById.get(nodeId)
        return <li key={nodeId}><p>{record.domain_name} / {record.course_name} · {record.kind}</p><h2><Link to={`/node/${nodeId}?source=search`}>{record.title}</Link></h2><p>{result.excerpt}</p><small>{record.tags.join(' · ')} {nodeState?.completed ? '· 完成' : ''} {nodeState?.favorite ? '· 收藏' : ''} {nodeState?.unknown ? '· 不会' : ''}</small></li>
      })}</ol>}
      {query.trim() && searchState.status === 'ready' && searchState.skipped > 0 && <p className="search-diagnostic" role="status">已跳过 {searchState.skipped} 条无效或本地隐藏结果。</p>}
    </>}
  </section>
}
