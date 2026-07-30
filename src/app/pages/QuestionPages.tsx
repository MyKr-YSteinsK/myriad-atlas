import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { buildGenerationRequest } from '../data/question-chains'
import { useAppData } from '../data/app-data-context'
import { localState } from '../state/local-state'
import type { QuestionDraft } from '../state/reader-db'
import { useLocalStateSnapshot } from '../state/use-local-state'

function CopyRequest({ draft }: { draft: QuestionDraft }) {
  const [fallback, setFallback] = useState('')
  const text = buildGenerationRequest(draft)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      await localState.saveQuestionDraft({ ...draft, copied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      setFallback('')
    } catch {
      setFallback(text)
    }
  }
  return <div className="copy-request"><button type="button" onClick={() => void copy()}>复制生成请求</button>{fallback && <label>手动复制<textarea readOnly value={fallback} onFocus={(event) => event.currentTarget.select()} /></label>}</div>
}

export function QuestionsPage() {
  const local = useLocalStateSnapshot()
  const { state } = useAppData()
  const catalog = state.status === 'ready' || state.status === 'empty' ? state.data.catalog : undefined
  return <section className="atlas-page questions-page"><p className="atlas-coordinate">QUESTIONS / CHAINS</p><h1 tabIndex={-1}>问题链</h1>
    {local.questionChains.length === 0 && <div className="atlas-empty"><span>00</span><p>尚未建立问题链。可从任意阅读节点的“不会／追问”创建。</p></div>}
    <ol>{[...local.questionChains].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((chain) => {
      const draft = [...local.questionDrafts].reverse().find((entry) => entry.chain_id === chain.chain_id)
      const source = catalog?.nodes.find((node) => node.id === chain.root_node_id)
      return <li key={chain.chain_id}><p>{chain.chain_id} · {chain.status}</p><h2><Link to={`/me/questions/${chain.chain_id}`}>{source?.title ?? chain.root_node_id}</Link></h2><p>{draft?.question ?? '已导入正式解答'}</p></li>
    })}</ol>
  </section>
}

export function QuestionDetailPage() {
  const { chainId = '' } = useParams()
  const local = useLocalStateSnapshot()
  const { state } = useAppData()
  const chain = local.questionChains.find((entry) => entry.chain_id === chainId)
  if (!chain || (state.status !== 'ready' && state.status !== 'empty')) return <section className="atlas-page"><h1 tabIndex={-1}>问题链不存在</h1></section>
  const formal = state.data.qaIndex.chains.find((entry) => entry.chain_id === chainId)
  const drafts = local.questionDrafts.filter((entry) => entry.chain_id === chainId)
  const source = state.data.catalog.nodes.find((entry) => entry.id === chain.root_node_id)
  return <section className="atlas-page question-detail"><p className="atlas-coordinate">{chain.chain_id} / {chain.status}</p><h1 tabIndex={-1}>{source?.title ?? chain.root_node_id}</h1>
    {chain.status === 'id-conflict' && <p role="alert">预留 ID 已被不同来源链占用，已停止自动绑定。</p>}
    <ol className="question-timeline"><li><strong>来源</strong><p>{source?.title ?? chain.root_node_id}</p></li>{drafts.map((draft) => <li key={draft.draft_id}><strong>{draft.parent_node_id ? '追问' : '问题'}</strong><p>{draft.question}</p><small>{draft.status}</small>{draft.status === 'awaiting-import' && <CopyRequest draft={draft} />}</li>)}{formal?.answers.map((answer) => <li key={answer.node_id}><strong>正式解答</strong><p><Link to={`/node/${answer.node_id}`}>{answer.title}</Link></p></li>)}</ol>
    <button type="button" onClick={() => {
      if (window.confirm(`隐藏整条链将影响 ${formal?.answers.length ?? 0} 篇正式答案；可在待删除中撤销。`)) void localState.hideQuestionChain(chain.chain_id, chain.root_node_id)
    }}>本地隐藏整条链</button>
  </section>
}
