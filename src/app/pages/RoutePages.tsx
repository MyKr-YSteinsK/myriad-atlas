import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { RuntimeRoute } from '../../content/types'
import { useAppData } from '../data/app-data-context'
import { loadRouteDetails, type RouteDetailResult } from '../data/route-details'
import { continueRoute, routeProgress } from '../data/route-progress'
import { localState } from '../state/local-state'
import { useLocalStateSnapshot } from '../state/use-local-state'
import { PageHeader, StateMessage } from '../components/PageHeader'

function useRouteDetails(ids: string[]) {
  const { repository } = useAppData()
  const [results, setResults] = useState<RouteDetailResult[]>([])
  const [retries, setRetries] = useState<Record<string, number>>({})
  const key = ids.map((id) => `${id}:${retries[id] ?? 0}`).join(',')
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    void loadRouteDetails(ids, repository.loadRoute.bind(repository), controller.signal).then((next) => {
      if (active) setResults(next)
    })
    return () => { active = false; controller.abort() }
  }, [key, repository]) // eslint-disable-line react-hooks/exhaustive-deps
  return {
    results,
    retry: (id: string) => setRetries((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 })),
  }
}

export function RoutesPage() {
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  const routeRecords = state.status === 'ready' || state.status === 'empty' ? state.data.routes.routes : []
  const { results, retry } = useRouteDetails(routeRecords.map((route) => route.id))
  const completed = useMemo(() => new Set(local.nodeStates.filter((entry) => entry.completed).map((entry) => entry.node_id)), [local.nodeStates])
  return <section className="atlas-page route-list-page"><PageHeader kicker="PATHS / INDEX" title="路线" summary="沿经过编排的知识路径前进，在当前位置继续，或从任一阶段重新进入。" />
    {state.status === 'loading' && <StateMessage code="···" title="正在加载路线"><p role="status">正在读取路线结构与本地进度。</p></StateMessage>}
    {routeRecords.length === 0 && state.status !== 'loading' && <StateMessage code="00" title="当前没有正式路线"><p>你仍可以从知识库或随机漫游开始探索。</p></StateMessage>}
    <ol className="route-index">{routeRecords.map((record) => {
      const result = results.find((entry) => entry.id === record.id)
      if (result?.error) return <li key={record.id}><span className="route-code">{record.code}</span><div><h2><Link to={`/route/${record.id}`}>{record.name}</Link></h2><p role="alert">{result.error}</p><button type="button" onClick={() => retry(record.id)}>重试加载路线</button></div></li>
      if (!result?.route) return <li key={record.id}><span className="route-code">{record.code}</span><div><h2><Link to={`/route/${record.id}`}>{record.name}</Link></h2><p role="status">正在加载路线…</p></div></li>
      const route = result.route
      const progress = routeProgress(route, completed)
      const position = local.routePositions.find((entry) => entry.route_id === route.id)
      const target = continueRoute(route, completed, position)
      const currentUnit = route.stages.flatMap((stage) => stage.modules.flatMap((module) => module.units)).find((unit) => unit.node_id === position?.node_id)
      return <li key={route.id} data-completed={progress.ratio === 1}><span className="route-code">{route.code}</span><div className="route-entry"><header><h2><Link to={`/route/${route.id}`}>{route.name}</Link></h2><span>{Math.round(progress.ratio * 100)}%</span></header><p className="route-summary">{route.summary}</p><div className="route-position"><span>当前位置</span><strong>{currentUnit?.title ?? (progress.ratio === 1 ? '路线完成' : '尚未开始')}</strong><span>下一节点</span><strong>{target?.unit.title ?? '查看路线总结'}</strong></div><div className="route-line" role="progressbar" aria-label={`${route.name}进度`} aria-valuenow={progress.completed} aria-valuemin={0} aria-valuemax={progress.total}><i style={{ transform: `scaleX(${progress.ratio})` }} /></div><footer><span>{progress.completed} / {progress.total} 个主线与综合任务</span><Link to={target ? `/node/${target.unit.node_id}?source=route&route=${route.id}&stage=${target.stageId}&module=${target.moduleId}` : `/route/${route.id}`}>{progress.ratio === 1 ? '查看总结' : position ? '继续路线' : '开始路线'}</Link></footer></div></li>
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
  return <section className="atlas-page route-detail-page"><PageHeader variant="context" kicker={`${route.code} / PATH`} title={route.name} summary={route.summary} meta={<><strong>{Math.round(progress.ratio * 100)}%</strong><span>路线完成度</span></>} actions={target
      ? <Link to={`/node/${target.unit.node_id}?source=route&route=${route.id}&stage=${target.stageId}&module=${target.moduleId}`}>继续路线</Link>
      : <span>路线已完成</span>} />
    <div className="route-overview"><strong>{progress.completed} / {progress.total}</strong><span>主线与综合任务</span><div className="route-line" role="progressbar" aria-label="路线总进度" aria-valuenow={progress.completed} aria-valuemin={0} aria-valuemax={progress.total}><i style={{ transform: `scaleX(${progress.ratio})` }} /></div><p>可选节点不计入 100% 路线进度。</p></div>
    <ol className="route-stages">{route.stages.map((stage, stageIndex) => <li key={stage.id}><header className="route-stage-header"><p className="section-index">STAGE {String(stageIndex + 1).padStart(2, '0')}</p><h2>{stage.name}</h2><p>{stage.summary}</p></header>
      {stage.modules.map((module, moduleIndex) => <section key={module.id} className="route-module"><header><span>MODULE {String(moduleIndex + 1).padStart(2, '0')}</span><div><h3>{module.name}</h3><p>{module.summary}</p></div></header><ol>{[...module.units].sort((a, b) => a.order - b.order).map((unit) => {
        const done = completed.has(unit.node_id)
        const current = position?.node_id === unit.node_id
        return <li key={unit.node_id} data-completed={done} data-current={current} data-role={unit.role}><span className="route-unit-sequence">{String(unit.order).padStart(2, '0')}</span><div><div className="route-unit-meta"><span>{unit.role === 'core' ? 'CORE' : unit.role === 'optional' ? 'OPTIONAL' : 'SYNTHESIS'}</span>{current && <strong>当前位置</strong>}{done && <strong>已完成</strong>}</div><h4><Link to={`/node/${unit.node_id}?source=route&route=${route.id}&stage=${stage.id}&module=${module.id}`} onClick={() => { void localState.saveRoutePosition({ route_id: route.id, stage_id: stage.id, module_id: module.id, node_id: unit.node_id }) }}>{unit.title}</Link></h4><p>{unit.summary}</p></div></li>
      })}</ol></section>)}
    </li>)}</ol>
  </section>
}
