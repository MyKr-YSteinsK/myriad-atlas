import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { contentRepository } from '../../lib/content-client'
import { MiniRoute, StateGlyph } from '../components/visual'
import { buildKnowledgeMapViewModel, mapFilters, type KnowledgeMapViewModel } from '../data/knowledge-map-model'
import { nodeVisualState } from '../data/node-visual-state'
import { useLocalStateSnapshot } from '../state/use-local-state'
import { PageHeader, StateMessage } from '../components/PageHeader'

export function KnowledgeMapPage() {
  const [view, setView] = useState<KnowledgeMapViewModel>()
  const [error, setError] = useState<string>()
  const [params, setParams] = useSearchParams()
  const [relations, setRelations] = useState(true)
  const local = useLocalStateSnapshot()
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([contentRepository.loadKnowledgeMap(controller.signal), contentRepository.loadCatalog(controller.signal), contentRepository.loadTaxonomy(controller.signal), contentRepository.loadRoutesIndex(controller.signal)])
      .then(([map, catalog, taxonomy, routes]) => setView(buildKnowledgeMapViewModel(map, catalog, taxonomy, routes)))
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : '知识地图无法加载')
      })
    return () => controller.abort()
  }, [])
  const filters = useMemo(() => view ? mapFilters(params, view) : { domain: '', course: '', route: '', node: '' }, [params, view])
  const setFilter = (next: Partial<typeof filters>) => {
    const value = { ...filters, ...next }
    const query = new URLSearchParams()
    for (const key of ['domain', 'course', 'route', 'node'] as const) if (value[key]) query.set(key, value[key])
    setParams(query)
  }
  const nodes = useMemo(() => view?.nodes.filter((node) => (!filters.domain || node.domainId === filters.domain) && (!filters.course || node.courseId === filters.course)) ?? [], [filters, view])
  const states = useMemo(() => new Map(local.nodeStates.map((state) => [state.node_id, state])), [local.nodeStates])
  if (error) return <section className="atlas-page"><PageHeader kicker="MAP / KNOWLEDGE" title="知识航图" /><StateMessage code="!" title="航图无法建立" tone="error"><p role="alert">{error}</p></StateMessage></section>
  if (!view) return <section className="atlas-page"><PageHeader kicker="MAP / KNOWLEDGE" title="知识航图" /><StateMessage code="···" title="正在加载航图"><p role="status">正在连接图结构与知识目录。</p></StateMessage></section>
  const focused = view.nodes.find((node) => node.id === filters.node)
  const courses = filters.domain ? view.domains.find((entry) => entry.id === filters.domain)?.courses ?? [] : view.domains.flatMap((entry) => entry.courses)
  const related = focused ? view.edges.filter((edge) => edge.from === focused.id || edge.to === focused.id) : []
  const selectedRoute = view.routes.find((route) => route.id === filters.route)
  const routePosition = selectedRoute ? local.routePositions.find((position) => position.route_id === selectedRoute.id) : undefined
  const routeCurrentIndex = selectedRoute ? selectedRoute.nodeIds.findIndex((id) => id === routePosition?.node_id) : undefined
  const routeCompleted = selectedRoute?.nodeIds.filter((id) => states.get(id)?.completed).length ?? 0
  const nodeTitles = new Map(view.nodes.map((node) => [node.id, node.title]))
  const nodeHref = (id: string) => {
    const query = new URLSearchParams({ map: '1' })
    for (const key of ['domain', 'course', 'route', 'node'] as const) if (filters[key]) query.set(key, key === 'node' ? id : filters[key])
    return '/node/' + id + '?' + query
  }
  return <section className="knowledge-map-page">
    <PageHeader variant="display" kicker="MAP / KNOWLEDGE" title="知识航图" meta={<span>{String(view.nodes.length) + ' NODES / ' + String(view.edges.length) + ' EDGES'}</span>} />
    <div className="knowledge-map-workspace">
      <aside className="knowledge-map-filter-rail">
        <div className="knowledge-map-controls">
          <label>领域<select value={filters.domain} onChange={(event) => setFilter({ domain: event.target.value, course: '', node: '' })}><option value="">全部领域</option>{view.domains.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label>课程<select value={filters.course} onChange={(event) => setFilter({ course: event.target.value, node: '' })}><option value="">全部课程</option>{courses.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label>路线叠层<select value={filters.route} onChange={(event) => setFilter({ route: event.target.value })}><option value="">不显示</option>{view.routes.map((entry) => <option key={entry.id} value={entry.id}>{entry.code + ' / ' + entry.name}</option>)}</select></label>
          <label className="knowledge-map-toggle"><input type="checkbox" checked={relations} onChange={(event) => setRelations(event.target.checked)} />显示关系</label>
        </div>
        {selectedRoute && <section className="knowledge-map-route" data-route={selectedRoute.id}>
          <header><strong>{selectedRoute.code}</strong><span>{selectedRoute.name}</span></header>
          <MiniRoute count={selectedRoute.nodeIds.length} currentIndex={routeCurrentIndex === -1 ? undefined : routeCurrentIndex} completed={routeCompleted} label={selectedRoute.name + ' 路线叠层'} />
          <small>{selectedRoute.summary}</small>
        </section>}
      </aside>
      <div className="knowledge-map-canvas">
        {nodes.length === 0 ? <StateMessage code="00" title={view.nodes.length ? '当前筛选下没有节点' : '知识地图还没有节点'}><p>{view.nodes.length ? '调整左侧筛选以返回航图。' : '加入正式知识后，这里会按领域和课程形成航图。'}</p></StateMessage> : <div className="knowledge-map-tracks">
          {view.domains.filter((domain) => !filters.domain || domain.id === filters.domain).map((domain) => {
            const domainNodes = nodes.filter((node) => node.domainId === domain.id)
            if (!domainNodes.length) return null
            return <section key={domain.id} className="knowledge-map-domain"><header><span>DOMAIN</span><h2>{domain.name}</h2><small>{String(domainNodes.length) + ' NODES'}</small></header>
              {domain.courses.filter((course) => !filters.course || course.id === filters.course).map((course) => {
                const track = domainNodes.filter((node) => node.courseId === course.id)
                if (!track.length) return null
                return <section key={course.id} className="knowledge-map-course"><h3>{course.name}</h3><ol>{track.map((node) => {
                  const state = states.get(node.id)
                  const inRoute = selectedRoute?.nodeIds.includes(node.id)
                  const focusedNode = node.id === filters.node
                  return <li key={node.id} className={inRoute ? 'map-node map-node-route' : 'map-node'} data-focused={focusedNode} data-completed={Boolean(state?.completed)}>
                    <span>{String(node.sequence).padStart(2, '0')}</span><StateGlyph state={nodeVisualState(state, node.kind)} announce={false} />
                    <button type="button" onClick={() => setFilter({ node: node.id })}><strong>{node.title}</strong><small>{node.courseName + ' / ' + String(node.sequence)}</small>{focusedNode && <p>{node.summary}</p>}</button>
                  </li>
                })}</ol></section>
              })}
            </section>
          })}
        </div>}
      </div>
      <aside className="knowledge-map-focus" aria-live="polite" data-empty={!focused}>
        {focused ? <><p className="atlas-coordinate">FOCUS / {focused.id}</p><div className="knowledge-map-focus-title"><StateGlyph state={nodeVisualState(states.get(focused.id), focused.kind)} /><h2>{focused.title}</h2></div><p>{focused.domainName + ' / ' + focused.courseName + ' / 第 ' + String(focused.sequence) + ' 节'}</p><p>{focused.summary}</p>
          {relations && <ul>{related.map((edge) => {
            const other = edge.from === focused.id ? edge.to : edge.from
            const relationTitle = edge.type === 'route' ? view.routes.find((route) => route.id === edge.route_id)?.name : nodeTitles.get(other)
            const relationLabel = edge.type === 'prerequisite' ? '前置' : edge.type === 'related' ? '关联' : '路线'
            return <li key={edge.type + '-' + edge.from + '-' + edge.to}><span className="relation-marker" data-relation={edge.type} aria-hidden="true" /><div><span>{relationLabel}</span><strong>{relationTitle ?? other}</strong></div></li>
          })}</ul>}
          <Link to={nodeHref(focused.id)}>打开知识</Link>
        </> : <><p className="atlas-coordinate">FOCUS</p><p>选择轨道中的节点，在这里查看摘要与关系。</p></>}
      </aside>
    </div>
    <p className="knowledge-map-meta">知识版本 {view.contentVersion} / 确定性课程轨道</p>
  </section>
}
