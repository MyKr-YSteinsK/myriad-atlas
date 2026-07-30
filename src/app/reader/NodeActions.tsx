import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { RuntimeCatalog, RuntimeNode, RuntimeRoute } from '../../content/types'
import { contentRepository } from '../../lib/content-client'
import { continueRoute } from '../data/route-progress'
import { createFollowUp, createUnknownQuestionChain } from '../data/question-chains'
import { useOptionalAppData } from '../data/app-data-context'
import { localState } from '../state/local-state'
import { useLocalStateSnapshot } from '../state/use-local-state'

export function NodeActions({ node, catalog }: { node: RuntimeNode; catalog?: RuntimeCatalog }) {
  const local = useLocalStateSnapshot()
  const appData = useOptionalAppData()
  const location = useLocation()
  const navigate = useNavigate()
  const [unknownOpen, setUnknownOpen] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [undoNote, setUndoNote] = useState<string>()
  const [route, setRoute] = useState<RuntimeRoute>()
  const parameters = new URLSearchParams(location.search)
  const source = parameters.get('source')
  const state = local.nodeStates.find((entry) => entry.node_id === node.id)
  useEffect(() => {
    const routeId = source === 'route' ? parameters.get('route') : ''
    if (!routeId) return
    const controller = new AbortController()
    contentRepository.loadRoute(routeId, controller.signal).then(setRoute).catch(() => undefined)
    return () => controller.abort()
  }, [location.search, source]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = (operation: () => Promise<unknown>): void => {
    setError('')
    operation().catch(() => setError('状态保存失败，操作未生效。'))
  }
  const completed = new Set(local.nodeStates.filter((entry) => entry.completed).map((entry) => entry.node_id))
  const routePosition = source === 'route' ? {
    route_id: parameters.get('route') ?? '', stage_id: parameters.get('stage') ?? '',
    module_id: parameters.get('module') ?? '', node_id: node.id, updated_at: '',
  } : undefined
  const routeTarget = route ? continueRoute(route, completed, routePosition) : undefined
  const courseNext = source === 'course' ? catalog?.nodes.filter((entry) => entry.domain_id === node.domain_id && entry.course_id === node.course_id)
    .filter((entry) => !local.nodeStates.find((value) => value.node_id === entry.id)?.uninterested)
    .sort((a, b) => a.sequence - b.sequence).find((entry) => entry.sequence > node.sequence) : undefined
  const createQuestion = async (): Promise<void> => {
    if (!appData || appData.state.status !== 'ready' && appData.state.status !== 'empty') throw new Error('问题链数据尚未加载')
    const record = appData.state.data.catalog.nodes.find((entry) => entry.id === node.id)
    if (!record) throw new Error('来源节点不在目录中')
    if (node.qa) {
      await localState.setUnknown(node.id, note)
      const formal = appData.state.data.qaIndex.chains.find((entry) => entry.chain_id === node.qa!.chain_id)
      if (!formal) throw new Error('正式问题链索引缺失')
      let chain = local.questionChains.find((entry) => entry.chain_id === formal.chain_id)
      if (!chain) {
        const timestamp = new Date().toISOString()
        chain = {
          chain_id: formal.chain_id, root_node_id: formal.root_node_id,
          reserved_first_answer_id: formal.answers[0].node_id, status: 'answered',
          created_at: timestamp, updated_at: timestamp,
        }
        await localState.saveQuestionChain(chain)
      }
      await createFollowUp(chain, record, appData.state.data.qaIndex, note)
      navigate(`/me/questions/${chain.chain_id}`)
    } else {
      const created = await createUnknownQuestionChain(record, appData.state.data.qaIndex, note)
      navigate(`/me/questions/${created.chain.chain_id}`)
    }
  }
  const createQuestionAndClose = async (): Promise<void> => {
    setError('')
    try {
      await createQuestion()
      setUnknownOpen(false)
    } catch {
      setError('状态保存失败，操作未生效。')
    }
  }

  return <section className="node-actions" aria-labelledby="node-actions-title"><h2 id="node-actions-title">节点状态</h2>
    {error && <p role="alert">{error}</p>}
    <div><button type="button" aria-pressed={Boolean(state?.completed)} onClick={() => run(() => localState.toggleCompleted(node.id))}>{node.domain_id === 'knowledge-roaming' ? state?.completed ? '取消已读' : '已读' : state?.completed ? '取消完成' : '完成'}</button>
      <button type="button" aria-pressed={Boolean(state?.favorite)} onClick={() => run(() => localState.toggleFavorite(node.id))}>{state?.favorite ? '取消收藏' : '收藏'}</button>
      <button type="button" aria-pressed={Boolean(state?.unknown)} onClick={() => {
        if (state?.unknown) run(async () => {
          const previous = await localState.clearUnknown(node.id)
          setUndoNote(previous)
          window.setTimeout(() => setUndoNote(undefined), 5000)
        })
        else { setNote(state?.unknown_note ?? ''); setUnknownOpen(true) }
      }}>{state?.unknown ? '取消不会／追问' : '不会／追问'}</button>
      {node.domain_id === 'knowledge-roaming' && <button type="button" aria-pressed={Boolean(state?.uninterested)} onClick={() => {
        setUnknownOpen(false)
        run(async () => {
          if (!window.confirm('标记不感兴趣后将退出漫游和普通搜索，仍可在“待删除”中撤销。')) return
          await localState.markRoamingUninterested(node.id, '')
          navigate('/roaming')
        })
      }}>不感兴趣</button>}</div>
    {undoNote !== undefined && <p role="status">已取消不会。<button type="button" onClick={() => { run(() => localState.undoClearUnknown(node.id, undoNote)); setUndoNote(undefined) }}>撤销</button></p>}
    {unknownOpen && <div className="node-action-dialog" role="dialog" aria-modal="true" aria-labelledby="unknown-title"><h3 id="unknown-title">不会／追问</h3><label>具体问题或备注<textarea value={note} maxLength={5000} onChange={(event) => setNote(event.target.value)} /></label><button type="button" onClick={() => { run(() => localState.setUnknown(node.id, note)); setUnknownOpen(false) }}>只保存不会</button><button type="button" onClick={() => { void createQuestionAndClose() }}>{node.qa ? '继续追问' : '新建问题链'}</button><button type="button" onClick={() => setUnknownOpen(false)}>取消</button></div>}
    <nav aria-label="下一节点">{source === 'route' && routeTarget && routeTarget.unit.node_id !== node.id && <Link to={`/node/${routeTarget.unit.node_id}?source=route&route=${route!.id}&stage=${routeTarget.stageId}&module=${routeTarget.moduleId}`}>下一节点：{routeTarget.unit.title}</Link>}{source === 'course' && courseNext && <Link to={`/node/${courseNext.id}?source=course&domain=${node.domain_id}&course=${node.course_id}`}>课程下一篇：{courseNext.title}</Link>}{source === 'roaming' && <Link to="/roaming">换一个</Link>}{(source === 'search' || source === 'home' || !source) && <Link to={source === 'search' ? '/search' : '/'}>返回来源</Link>}</nav>
  </section>
}
