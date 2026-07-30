import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../data/app-data-context'
import { ReaderSettings } from '../reader/ReaderSettings'
import { useReaderPreferencePersistence } from '../reader/use-reader-preference-persistence'
import { localState } from '../state/local-state'
import { type Opinion } from '../state/reader-db'
import { useLocalStateSnapshot } from '../state/use-local-state'

function useCatalog() {
  const { state } = useAppData()
  return state.status === 'ready' || state.status === 'empty' ? state.data.catalog : undefined
}

function StateList({ mode }: { mode: 'completed' | 'favorite' | 'unknown' }) {
  const catalog = useCatalog()
  const local = useLocalStateSnapshot()
  const [sort, setSort] = useState('recent')
  if (!catalog) return <p>正在加载……</p>
  const byId = new Map(catalog.nodes.map((node) => [node.id, node]))
  const values = local.nodeStates.filter((state) => mode === 'completed' ? state.completed : mode === 'favorite' ? state.favorite : state.unknown)
    .sort((a, b) => sort === 'recent' ? b.updated_at.localeCompare(a.updated_at) : (byId.get(a.node_id)?.[sort === 'domain' ? 'domain_name' : 'course_name'] ?? '').localeCompare(byId.get(b.node_id)?.[sort === 'domain' ? 'domain_name' : 'course_name'] ?? '', 'zh-CN'))
  return <><label>排序<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">最近更新</option><option value="domain">领域</option><option value="course">课程</option></select></label><ol className="me-state-list">{values.map((state) => {
    const node = byId.get(state.node_id)
    if (!node) return <li key={state.node_id}><h2>{state.node_id}</h2><p>当前版本不可用。</p><button type="button" onClick={() => void localState.deleteNodeState(state.node_id)}>清除本地状态</button></li>
    return <li key={state.node_id}><p>{node.domain_name} / {node.course_name}</p><h2><Link to={`/node/${node.id}`}>{node.title}</Link></h2>{mode === 'unknown' && <label>备注<textarea value={state.unknown_note} onChange={(event) => void localState.setUnknown(node.id, event.target.value)} /></label>}<button type="button" onClick={() => {
      if (mode === 'completed') void localState.toggleCompleted(node.id)
      if (mode === 'favorite') void localState.toggleFavorite(node.id)
      if (mode === 'unknown') void localState.clearUnknown(node.id)
    }}>{mode === 'completed' ? node.kind === 'roaming' ? '取消已读' : '取消完成' : mode === 'favorite' ? '取消收藏' : '取消不会'}</button>{state.completed && state.unknown && <small>已完成 · 仍标记不会</small>}</li>
  })}</ol></>
}

export function MePage() {
  const local = useLocalStateSnapshot()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const { preferences, storageWarning, update, reset } = useReaderPreferencePersistence()
  const entries = [
    ['/me/completed', '已读 / 已完成', local.nodeStates.filter((entry) => entry.completed).length],
    ['/me/favorites', '收藏', local.nodeStates.filter((entry) => entry.favorite).length],
    ['/me/unknown', '不会／追问', local.nodeStates.filter((entry) => entry.unknown).length],
    ['/me/questions', '问题链', local.questionChains.length],
    ['/me/pending-removals', '待删除', local.pendingRemovals.length],
    ['/me/opinions', '意见', local.opinions.length],
  ] as const
  return <section className="atlas-page me-page"><p className="atlas-coordinate">LOCAL / ME</p><h1 tabIndex={-1}>我的</h1><ol>{entries.map(([to, label, count]) => <li key={to}><Link to={to}>{label}<span>{count}</span></Link></li>)}</ol>
    <section><h2>阅读设置</h2><p>{preferences.font === 'serif' ? '衬线' : '系统字体'} · {preferences.theme} · {preferences.fontSize}px</p>{storageWarning && <p role="status">阅读设置暂未写入本地。</p>}<button ref={settingsButton} type="button" onClick={() => setSettingsOpen(true)}>调整阅读设置</button></section>
    <p className="future-note">完整离线、备份恢复与更新管理将在后续阶段提供。</p>
    <ReaderSettings open={settingsOpen} preferences={preferences} onChange={update} onReset={reset} onClose={() => setSettingsOpen(false)} triggerRef={settingsButton} />
  </section>
}
export function CompletedPage() { return <section className="atlas-page"><h1 tabIndex={-1}>已读 / 已完成</h1><StateList mode="completed" /></section> }
export function FavoritesPage() { return <section className="atlas-page"><h1 tabIndex={-1}>收藏</h1><StateList mode="favorite" /></section> }
export function UnknownPage() { return <section className="atlas-page"><h1 tabIndex={-1}>不会／追问</h1><StateList mode="unknown" /></section> }

export function PendingRemovalsPage() {
  const local = useLocalStateSnapshot()
  return <section className="atlas-page"><h1 tabIndex={-1}>待删除</h1><p>下一次内容维护默认将这些记录转为物理删除批次；浏览器不会直接修改源码。</p><ol className="me-state-list">{local.pendingRemovals.map((entry) => <li key={entry.id}><p>{entry.kind}</p><h2>{entry.target_id}</h2><p>{entry.note || '无备注'} · {entry.created_at}</p><button type="button" onClick={() => {
    if (entry.kind === 'roaming-node') void localState.undoRoamingUninterested(entry.target_id)
    else if (entry.kind === 'qa-chain') void localState.undoHiddenQuestionChain(entry.target_id)
    else void localState.deletePendingRemoval(entry.id)
  }}>撤销</button></li>)}</ol></section>
}

function opinionText(opinions: Opinion[]): string {
  return opinions.map((entry) => `[${entry.scope === 'route' ? entry.route_id : '总体'}]\n${entry.text}`).join('\n\n')
}
export function OpinionsPage() {
  const local = useLocalStateSnapshot()
  const { state } = useAppData()
  const [text, setText] = useState('')
  const [routeId, setRouteId] = useState('')
  const [fallback, setFallback] = useState('')
  const routes = state.status === 'ready' || state.status === 'empty' ? state.data.routes.routes : []
  const save = (): void => {
    if (!text.trim()) return
    const timestamp = new Date().toISOString()
    const id = crypto.randomUUID()
    void localState.saveOpinion({ id, scope: routeId ? 'route' : 'global', route_id: routeId || null, text: text.trim(), created_at: timestamp, updated_at: timestamp })
    setText('')
  }
  const copy = async (values: Opinion[]): Promise<void> => {
    const value = opinionText(values)
    try { await navigator.clipboard.writeText(value); setFallback('') } catch { setFallback(value) }
  }
  return <section className="atlas-page opinions-page"><h1 tabIndex={-1}>意见</h1><div className="opinion-editor"><label>范围<select value={routeId} onChange={(event) => setRouteId(event.target.value)}><option value="">总体意见</option>{routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label><label>意见<textarea value={text} onChange={(event) => setText(event.target.value)} /></label><button type="button" onClick={save}>新增意见</button></div><div><button type="button" onClick={() => void copy(local.opinions)}>复制全部意见</button>{routes.map((route) => <button type="button" key={route.id} onClick={() => void copy(local.opinions.filter((entry) => entry.route_id === route.id))}>复制“{route.name}”意见</button>)}</div>{fallback && <textarea aria-label="手动复制意见" readOnly value={fallback} />}
    <ol className="me-state-list">{local.opinions.map((entry) => <li key={entry.id}><p>{entry.scope === 'route' ? routes.find((route) => route.id === entry.route_id)?.name ?? `${entry.route_id}（路线不可用）` : '总体'}</p><textarea value={entry.text} onChange={(event) => void localState.saveOpinion({ ...entry, text: event.target.value })} /><button type="button" onClick={() => void copy([entry])}>复制</button><button type="button" onClick={() => { if (window.confirm('删除这条意见？')) void localState.deleteOpinion(entry.id) }}>删除</button></li>)}</ol>
  </section>
}
