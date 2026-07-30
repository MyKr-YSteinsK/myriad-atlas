import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RuntimeRoute } from '../../content/types'
import { useAppData } from '../data/app-data-context'
import { continueRoute, routeProgress } from '../data/route-progress'
import { useLocalStateSnapshot } from '../state/use-local-state'

export function HomePage() {
  const { state, repository } = useAppData()
  const local = useLocalStateSnapshot()
  const [recentRouteState, setRecentRouteState] = useState<{ routeId: string; route?: RuntimeRoute }>()
  const latestPosition = useMemo(() => [...local.routePositions].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0], [local.routePositions])
  useEffect(() => {
    const controller = new AbortController()
    if (!latestPosition) {
      return () => controller.abort()
    }
    repository.loadRoute(latestPosition.route_id, controller.signal)
      .then((route) => setRecentRouteState({ routeId: latestPosition.route_id, route }))
      .catch(() => setRecentRouteState({ routeId: latestPosition.route_id }))
    return () => controller.abort()
  }, [latestPosition, repository])
  useEffect(() => { document.title = '万象回廊 · MyKr' }, [])

  if (state.status === 'loading') return <section className="atlas-page"><h1 tabIndex={-1}>万象回廊 · MyKr</h1><p role="status">正在加载知识航图……</p></section>
  if (state.status === 'error') return <section className="atlas-page"><h1 tabIndex={-1}>万象回廊 · MyKr</h1><p role="alert">{state.error.message}</p></section>
  const { catalog, taxonomy, routes, contentVersion } = state.data
  const recentRoute = recentRouteState?.routeId === latestPosition?.route_id ? recentRouteState.route : undefined
  const knownIds = new Set(catalog.nodes.map((node) => node.id))
  const states = local.nodeStates.filter((entry) => knownIds.has(entry.node_id))
  const completed = new Set(states.filter((entry) => entry.completed).map((entry) => entry.node_id))
  const latestReading = [...states].filter((entry) => (entry.reading_progress?.ratio ?? 0) > 0)
    .sort((a, b) => (b.reading_progress?.updated_at ?? '').localeCompare(a.reading_progress?.updated_at ?? ''))[0]
  const readingRecord = catalog.nodes.find((entry) => entry.id === latestReading?.node_id)
  const roaming = catalog.nodes.filter((node) => node.kind === 'roaming')
  const remainingRoaming = roaming.filter((node) => {
    const value = states.find((entry) => entry.node_id === node.id)
    return !value?.completed && !value?.uninterested
  }).length
  const routeTarget = recentRoute ? continueRoute(recentRoute, completed, latestPosition) : undefined
  const progress = recentRoute ? routeProgress(recentRoute, completed) : undefined
  const courseCount = taxonomy.domains.reduce((sum, domain) => sum + domain.courses.length, 0)

  return <section className="atlas-page home-page"><p className="atlas-coordinate">ORIGIN / {contentVersion}</p>
    <header className="site-header"><p className="site-kicker">Myriad Atlas · MyKr</p><h1 tabIndex={-1}>万象回廊 · MyKr</h1></header>
    {local.unavailable && <p className="local-state-warning" role="status">本地状态暂不可用；知识浏览仍可继续。</p>}
    {state.status === 'empty' && <div className="atlas-empty"><span aria-hidden="true">00</span><p>内容库尚未导入。</p></div>}
    {readingRecord && latestReading?.reading_progress && <section className="home-primary"><p className="section-index">01 / 继续阅读</p><h2>{readingRecord.title}</h2><p>{readingRecord.course_name} · {Math.round(latestReading.reading_progress.ratio * 100)}%</p><Link to={`/node/${readingRecord.id}?source=home`}>继续阅读</Link></section>}
    {recentRoute && progress && <section className="home-route"><p className="section-index">02 / 继续路线</p><h2>{recentRoute.name}</h2><p>{progress.completed} / {progress.total} 个主线与综合任务已完成</p>{routeTarget
      ? <Link to={`/node/${routeTarget.unit.node_id}?source=route&route=${recentRoute.id}&stage=${routeTarget.stageId}&module=${routeTarget.moduleId}`}>继续：{routeTarget.unit.title}</Link>
      : <Link to={`/route/${recentRoute.id}`}>查看路线总结</Link>}</section>}
    <section className="home-roaming"><p className="section-index">03 / 随机漫游</p><h2>随机漫游</h2><p>剩余 {remainingRoaming} 个可漫游节点。</p><Link to="/roaming">进入漫游</Link>{remainingRoaming === 0 && roaming.length > 0 && <p><Link to="/me/completed">恢复已读</Link> · <Link to="/me/pending-removals">查看待删除</Link></p>}</section>
    <section className="home-facts" aria-label="知识概况"><p className="section-index">04 / 知识概况</p><dl><div><dt>节点</dt><dd>{catalog.nodes.length}</dd></div><div><dt>课程</dt><dd>{courseCount}</dd></div><div><dt>路线</dt><dd>{routes.routes.length}</dd></div><div><dt>完成</dt><dd>{completed.size}</dd></div></dl></section>
  </section>
}
