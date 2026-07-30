import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { RuntimeRoute } from '../../content/types'
import { useAppData } from '../data/app-data-context'
import { continueRoute, routeProgress } from '../data/route-progress'
import { localState } from '../state/local-state'
import { useLocalStateSnapshot } from '../state/use-local-state'

function useRouteDetails(ids: string[]) {
  const { repository } = useAppData()
  const [routes, setRoutes] = useState<RuntimeRoute[]>([])
  const key = ids.join(',')
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(ids.map((id) => repository.loadRoute(id, controller.signal)))
      .then(setRoutes).catch(() => setRoutes([]))
    return () => controller.abort()
  }, [key, repository]) // eslint-disable-line react-hooks/exhaustive-deps
  return routes
}

export function RoutesPage() {
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  const routeRecords = state.status === 'ready' || state.status === 'empty' ? state.data.routes.routes : []
  const routes = useRouteDetails(routeRecords.map((route) => route.id))
  const completed = useMemo(() => new Set(local.nodeStates.filter((entry) => entry.completed).map((entry) => entry.node_id)), [local.nodeStates])
  return <section className="atlas-page route-list-page"><p className="atlas-coordinate">PATHS / INDEX</p><h1 tabIndex={-1}>路线</h1>
    {state.status === 'loading' && <p role="status">正在加载路线……</p>}
    {routeRecords.length === 0 && state.status !== 'loading' && <div className="atlas-empty"><span>00</span><p>当前没有正式路线。</p></div>}
    <ol className="route-index">{routes.map((route) => {
      const progress = routeProgress(route, completed)
      const position = local.routePositions.find((entry) => entry.route_id === route.id)
      const target = continueRoute(route, completed, position)
      return <li key={route.id}><span className="route-code">{route.code}</span><div><h2><Link to={`/route/${route.id}`}>{route.name}</Link></h2><p>{route.summary}</p><p>{progress.completed} / {progress.total}</p><div className="route-line"><i style={{ transform: `scaleX(${progress.ratio})` }} /></div><Link to={target ? `/node/${target.unit.node_id}?source=route&route=${route.id}&stage=${target.stageId}&module=${target.moduleId}` : `/route/${route.id}`}>{progress.ratio === 1 ? '查看总结' : position ? '继续路线' : '开始路线'}</Link></div></li>
    })}</ol>
  </section>
}

export function RouteDetailPage() {
  const { routeId = '' } = useParams()
  const { repository } = useAppData()
  const local = useLocalStateSnapshot()
  const [result, setResult] = useState<{ id: string; route?: RuntimeRoute; error?: string }>()
  useEffect(() => {
    const controller = new AbortController()
    repository.loadRoute(routeId, controller.signal)
      .then((route) => setResult({ id: routeId, route }))
      .catch((error: unknown) => setResult({ id: routeId, error: error instanceof Error ? error.message : '路线无法加载' }))
    return () => controller.abort()
  }, [repository, routeId])
  if (!result || result.id !== routeId) return <section className="atlas-page"><h1 tabIndex={-1}>路线详情</h1><p role="status">正在加载路线……</p></section>
  if (!result.route) return <section className="atlas-page"><h1 tabIndex={-1}>路线无法加载</h1><p role="alert">{result.error}</p></section>
  const route = result.route
  const completed = new Set(local.nodeStates.filter((entry) => entry.completed).map((entry) => entry.node_id))
  const position = local.routePositions.find((entry) => entry.route_id === route.id)
  const target = continueRoute(route, completed, position)
  const progress = routeProgress(route, completed)
  return <section className="atlas-page route-detail-page"><p className="atlas-coordinate">{route.code} / PATH</p><h1 tabIndex={-1}>{route.name}</h1><p>{route.summary}</p>
    <div className="route-overview"><strong>{progress.completed} / {progress.total}</strong><span>主线与综合任务</span>{target
      ? <Link to={`/node/${target.unit.node_id}?source=route&route=${route.id}&stage=${target.stageId}&module=${target.moduleId}`}>继续路线</Link>
      : <p>路线已完成。optional 未完成不影响 100%。</p>}</div>
    <ol className="route-stages">{route.stages.map((stage, stageIndex) => <li key={stage.id}><p className="section-index">STAGE {String(stageIndex + 1).padStart(2, '0')}</p><h2>{stage.name}</h2><p>{stage.summary}</p>
      {stage.modules.map((module) => <section key={module.id} className="route-module"><h3>{module.name}</h3><p>{module.summary}</p><ol>{[...module.units].sort((a, b) => a.order - b.order).map((unit) => {
        const done = completed.has(unit.node_id)
        const current = position?.node_id === unit.node_id
        return <li key={unit.node_id} data-completed={done}><span>{String(unit.order).padStart(2, '0')}</span><div><p>{unit.role === 'core' ? '主线' : unit.role === 'optional' ? '可选' : '综合任务'}{current ? ' · 当前位置' : ''}{done ? ' · 已完成' : ''}</p><h4><Link to={`/node/${unit.node_id}?source=route&route=${route.id}&stage=${stage.id}&module=${module.id}`} onClick={() => { void localState.saveRoutePosition({ route_id: route.id, stage_id: stage.id, module_id: module.id, node_id: unit.node_id }) }}>{unit.title}</Link></h4><p>{unit.summary}</p></div></li>
      })}</ol></section>)}
    </li>)}</ol>
  </section>
}
