import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RuntimeRoute } from '../../content/types'
import { useAppData } from '../data/app-data-context'
import { continueRoute, resolveRecentRoute, routeProgress } from '../data/route-progress'
import { useLocalStateSnapshot } from '../state/use-local-state'
import { BackupReminder, OfflineHomeHint } from '../offline/offline-hints'
import { PageHeader, SectionHeader, StateMessage } from '../components/PageHeader'

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

  if (state.status === 'loading') return <section className="atlas-page"><PageHeader variant="display" kicker="MYRIAD ATLAS" title="万象回廊 · MyKr" /><StateMessage code="···" title="正在加载知识航图"><p role="status">正在读取知识目录与个人状态。</p></StateMessage></section>
  if (state.status === 'error') return <section className="atlas-page"><PageHeader variant="display" kicker="MYRIAD ATLAS" title="万象回廊 · MyKr" /><StateMessage code="!" title="知识航图暂不可用" tone="error"><p role="alert">{state.error.message}</p></StateMessage></section>
  const { catalog, taxonomy, routes, contentVersion } = state.data
  const recentRoute = resolveRecentRoute(recentRouteState, latestPosition?.route_id)
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

  return <section className="atlas-page home-page"><PageHeader variant="display" kicker="MYRIAD ATLAS / ORIGIN" title="万象回廊" summary="沿路线深入、从索引查找，或让一次漫游带你进入知识世界。" meta={<><span>KNOWLEDGE</span><strong>{contentVersion}</strong></>} />
    {local.unavailable && <p className="local-state-warning" role="status">本地状态暂不可用；知识浏览仍可继续。</p>}
    {state.status === 'empty' && <StateMessage code="00" title="内容库尚未导入"><p>导入正式知识后，这里会形成你的探索原点。</p></StateMessage>}
    <div className="home-editorial"><div className="home-current-column"><section className="home-current"><SectionHeader index="01 / CURRENT" title="当前进行" />
      {readingRecord && latestReading?.reading_progress ? <div className="home-current-item"><span>最近阅读 · {Math.round(latestReading.reading_progress.ratio * 100)}%</span><h3>{readingRecord.title}</h3><p>{readingRecord.course_name}</p><div className="route-line"><i style={{ transform: `scaleX(${latestReading.reading_progress.ratio})` }} /></div><Link to={`/node/${readingRecord.id}?source=home`}>继续阅读</Link></div> : recentRoute && progress ? <div className="home-current-item"><span>最近路线 · {Math.round(progress.ratio * 100)}%</span><h3>{recentRoute.name}</h3><p>{progress.completed} / {progress.total} 个主线与综合任务已完成</p>{routeTarget
      ? <Link to={`/node/${routeTarget.unit.node_id}?source=route&route=${recentRoute.id}&stage=${routeTarget.stageId}&module=${routeTarget.moduleId}`}>继续：{routeTarget.unit.title}</Link>
      : <Link to={`/route/${recentRoute.id}`}>查看路线总结</Link>}</div> : <div className="home-current-empty"><p>还没有阅读足迹。</p><Link to="/library">从知识索引开始</Link></div>}
    </section></div><div className="home-secondary-column">
      {recentRoute && progress && readingRecord && <section className="home-route"><SectionHeader index="02 / PATH" title="继续路线" /><h3>{recentRoute.name}</h3><p>{progress.completed} / {progress.total} 个主线与综合任务已完成</p>{routeTarget ? <Link to={`/node/${routeTarget.unit.node_id}?source=route&route=${recentRoute.id}&stage=${routeTarget.stageId}&module=${routeTarget.moduleId}`}>下一站：{routeTarget.unit.title}</Link> : <Link to={`/route/${recentRoute.id}`}>查看路线总结</Link>}</section>}
      <section className="home-roaming"><SectionHeader index="03 / ROAM" title="漫游" /><p>剩余 <strong>{remainingRoaming}</strong> 个可漫游节点。</p><Link to="/roaming">抽取一个知识节点</Link>{remainingRoaming === 0 && roaming.length > 0 && <p><Link to="/me/completed">恢复已读</Link> · <Link to="/me/pending-removals">查看待删除</Link></p>}</section>
    </div></div>
    <section className="home-facts" aria-label="知识概况"><SectionHeader index="04 / INDEX" title="知识概况" /><dl><div><dt>节点</dt><dd>{catalog.nodes.length}</dd></div><div><dt>课程</dt><dd>{courseCount}</dd></div><div><dt>路线</dt><dd>{routes.routes.length}</dd></div><div><dt>完成</dt><dd>{completed.size}</dd></div></dl></section>
    <div className="home-system-hints"><OfflineHomeHint /><BackupReminder /></div>
  </section>
}
