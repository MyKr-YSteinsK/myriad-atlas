import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RuntimeRoute } from '../../content/types'
import { useAppData } from '../data/app-data-context'
import { continueRoute, resolveRecentRoute, routeProgress } from '../data/route-progress'
import { useLocalStateSnapshot } from '../state/use-local-state'
import { BackupReminder, OfflineHomeHint } from '../offline/offline-hints'
import { PageHeader, StateMessage } from '../components/PageHeader'
import { AtlasMiniMap, MetricBar, MetricStrip, MiniRoute, ProgressTrack, StateGlyph, type AtlasMiniMapNode, type RouteRole } from '../components/visual'
import { homeMetricScale, resolveHomeAtlasAnchor } from '../data/home-origin'

export function HomePage() {
  const { state, repository } = useAppData()
  const local = useLocalStateSnapshot()
  const [recentRouteState, setRecentRouteState] = useState<{ routeId: string; route?: RuntimeRoute }>()
  const latestPosition = useMemo(() => [...local.routePositions].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0], [local.routePositions])
  useEffect(() => {
    const controller = new AbortController()
    if (!latestPosition) return () => controller.abort()
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
  const stateByNodeId = new Map(states.map((entry) => [entry.node_id, entry]))
  const completed = new Set(states.filter((entry) => entry.completed).map((entry) => entry.node_id))
  const latestReading = [...states].filter((entry) => (entry.reading_progress?.ratio ?? 0) > 0)
    .sort((a, b) => (b.reading_progress?.updated_at ?? '').localeCompare(a.reading_progress?.updated_at ?? ''))[0]
  const readingRecord = catalog.nodes.find((entry) => entry.id === latestReading?.node_id)
  const roaming = catalog.nodes.filter((node) => node.kind === 'roaming')
  const remainingRoaming = roaming.filter((node) => {
    const value = stateByNodeId.get(node.id)
    return !value?.completed && !value?.uninterested
  }).length
  const routeTarget = recentRoute ? continueRoute(recentRoute, completed, latestPosition) : undefined
  const progress = recentRoute ? routeProgress(recentRoute, completed) : undefined
  const courseCount = taxonomy.domains.reduce((sum, domain) => sum + domain.courses.length, 0)
  const routeUnits = recentRoute?.stages.flatMap((stage) => stage.modules.flatMap((module) => module.units)) ?? []
  const routeCurrentIndex = routeTarget ? routeUnits.findIndex((unit) => unit.node_id === routeTarget.unit.node_id) : undefined
  const routeRoles: RouteRole[] = routeUnits.map((unit) => unit.role === 'anchor' ? 'synthesis' : unit.role)
  const anchor = resolveHomeAtlasAnchor(readingRecord?.id, recentRoute?.code)
  const atlasNodes: AtlasMiniMapNode[] = catalog.nodes.length === 0 ? [] : [
    { id: 'courses', label: String(courseCount) + ' COURSE', state: courseCount > 0 ? 'unread' : 'completed' },
    { id: 'routes', label: String(routes.routes.length) + ' PATH', state: recentRoute ? 'current' : 'unread' },
    { id: 'roam', label: String(remainingRoaming) + ' ROAM', state: 'roaming' },
    { id: 'completed', label: String(completed.size) + ' DONE', state: completed.size > 0 ? 'completed' : 'unread' },
  ]
  const comparativeMaximum = homeMetricScale([catalog.nodes.length, courseCount, routes.routes.length])

  return <section className="atlas-page home-page">
    <PageHeader variant="display" kicker="MYRIAD ATLAS" title="万象回廊" meta={<span>{contentVersion.slice(0, 7)}</span>} />
    {local.unavailable && <p className="local-state-warning" role="status">本地状态暂不可用；知识浏览仍可继续。</p>}
    {state.status === 'empty' && <StateMessage code="00" title="内容库尚未导入"><p>导入正式知识后，这里会形成你的探索原点。</p></StateMessage>}

    <div className="home-origin-grid">
      <section className="home-atlas-core" aria-labelledby="home-atlas-core-title">
        <header><p className="atlas-coordinate">ATLAS / CORE</p><h2 id="home-atlas-core-title" className="sr-only">知识位置概览</h2></header>
        <AtlasMiniMap center={{ id: anchor.kind, label: anchor.label, state: anchor.state }} nodes={atlasNodes} label={'知识位置概览：' + anchor.label} />
        <MetricBar value={completed.size} max={catalog.nodes.length} label="完成" tone="success" />
      </section>

      <section className="home-current-action" aria-labelledby="home-current-title">
        {readingRecord && latestReading?.reading_progress ? <><header><div><StateGlyph state="current" announce={false} /><p className="atlas-coordinate">01 · CURRENT</p></div><output aria-label="当前阅读进度">{Math.round(latestReading.reading_progress.ratio * 100)}%</output></header><h2 id="home-current-title">{readingRecord.title}</h2><p className="home-current-coordinate">{readingRecord.course_name}</p><ProgressTrack variant="reading" ratio={latestReading.reading_progress.ratio} label={readingRecord.title + ' 阅读进度'} /><Link className="atlas-primary-link" to={'/node/' + readingRecord.id + '?source=home'}>继续阅读</Link></>
          : recentRoute && progress ? <><header><div><StateGlyph state={progress.ratio === 1 ? 'completed' : 'current'} announce={false} /><p className="atlas-coordinate">01 · CURRENT</p></div><output aria-label="当前路线进度">{Math.round(progress.ratio * 100)}%</output></header><h2 id="home-current-title">{recentRoute.name}</h2><MiniRoute units={routeRoles.map((role) => ({ role }))} currentIndex={routeCurrentIndex} completed={progress.completed} label={recentRoute.name + ' 路线进度'} /><p className="home-current-coordinate">{routeTarget ? 'NEXT · ' + routeTarget.unit.title : 'ROUTE COMPLETE'}</p>{routeTarget ? <Link className="atlas-primary-link" to={'/node/' + routeTarget.unit.node_id + '?source=route&route=' + recentRoute.id + '&stage=' + routeTarget.stageId + '&module=' + routeTarget.moduleId}>继续</Link> : <Link className="atlas-primary-link" to={'/route/' + recentRoute.id}>查看总结</Link>}</>
            : <div className="home-current-empty"><StateGlyph state="unread" announce={false} /><div><p className="atlas-coordinate">01 · CURRENT</p><h2 id="home-current-title">从索引开始</h2><p>还没有阅读足迹。</p><Link className="atlas-primary-link" to="/library">打开知识库</Link></div></div>}
      </section>
    </div>

    <div className="home-secondary-grid">
      {recentRoute && progress && readingRecord && <section className="home-path" aria-labelledby="home-path-title"><header><p className="atlas-coordinate">02 · PATH</p><h2 id="home-path-title">{recentRoute.name}</h2></header><MiniRoute units={routeRoles.map((role) => ({ role }))} currentIndex={routeCurrentIndex} completed={progress.completed} label={recentRoute.name + ' 路线进度'} /><p>{routeTarget ? 'NEXT · ' + routeTarget.unit.title : 'ROUTE COMPLETE'}</p><Link to={routeTarget ? '/node/' + routeTarget.unit.node_id + '?source=route&route=' + recentRoute.id + '&stage=' + routeTarget.stageId + '&module=' + routeTarget.moduleId : '/route/' + recentRoute.id}>{progress.ratio === 1 ? '查看总结' : '继续'}</Link></section>}

      <section className="home-roaming" aria-labelledby="home-roaming-title"><header><p className="atlas-coordinate">03 · ROAM</p><h2 id="home-roaming-title">漫游</h2></header><div className="home-roam-field" aria-label={'剩余 ' + String(remainingRoaming) + ' 个可漫游节点'}>{roaming.filter((node) => !stateByNodeId.get(node.id)?.uninterested).slice(0, 12).map((node) => <StateGlyph key={node.id} state={stateByNodeId.get(node.id)?.completed ? 'completed' : stateByNodeId.get(node.id)?.unknown ? 'unknown' : 'roaming'} />)}</div><MetricBar value={remainingRoaming} max={roaming.length} label="可漫游" tone="warning" /><Link to="/roaming">探索一个节点</Link>{remainingRoaming === 0 && roaming.length > 0 && <p><Link to="/me/completed">恢复已读</Link> · <Link to="/me/pending-removals">查看待删除</Link></p>}</section>

      <section className="home-index" aria-labelledby="home-index-title"><header><p className="atlas-coordinate">04 · INDEX</p><h2 id="home-index-title">知识构成</h2></header><MetricStrip label="知识构成" items={[
        { id: 'nodes', label: 'NODES', value: catalog.nodes.length, max: comparativeMaximum },
        { id: 'courses', label: 'COURSES', value: courseCount, max: comparativeMaximum },
        { id: 'routes', label: 'PATHS', value: routes.routes.length, max: comparativeMaximum },
        { id: 'completed', label: 'COMPLETE', value: completed.size, max: catalog.nodes.length, tone: 'success' },
      ]} /></section>
    </div>
    <div className="home-system-hints"><OfflineHomeHint /><BackupReminder /></div>
  </section>
}
