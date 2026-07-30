import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { CatalogRecord } from '../../content/types'
import { useAppData } from '../data/app-data-context'
import { pickRoaming, roamingEmptyReason, roamingPool } from '../data/roaming'
import { useLocalStateSnapshot } from '../state/use-local-state'

const emptyMessages = {
  'no-content': '当前没有漫游内容。',
  'all-read': '全部漫游内容均已读。',
  'all-uninterested': '全部漫游内容均标记为不感兴趣。',
} as const

export function RoamingPage() {
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  const [current, setCurrent] = useState<CatalogRecord>()
  if (state.status !== 'ready' && state.status !== 'empty') return <section className="atlas-page"><h1 tabIndex={-1}>随机漫游</h1><p>正在加载……</p></section>
  const pool = roamingPool(state.data.catalog.nodes, local.nodeStates)
  const reason = roamingEmptyReason(state.data.catalog.nodes, local.nodeStates)
  const select = (): void => setCurrent(pickRoaming(pool, current?.id))
  return <section className="atlas-page roaming-page"><p className="atlas-coordinate">ROAMING / RANDOM</p><h1 tabIndex={-1}>随机漫游</h1><p>从未读且未标记不感兴趣的节点中安全随机抽取。打开节点不会自动标记已读。</p>
    {reason && <div className="atlas-empty"><span>00</span><p>{emptyMessages[reason]} {reason === 'all-read' && <Link to="/me/completed">前往已读知识恢复</Link>}{reason === 'all-uninterested' && <Link to="/me/pending-removals">前往待删除撤销</Link>}</p></div>}
    {!reason && <button className="roaming-pick" type="button" onClick={select}>{current ? '换一个' : '开始漫游'}</button>}
    {current && pool.some((entry) => entry.id === current.id) && <article className="roaming-current"><p>{current.domain_name} / {current.course_name}</p><h2>{current.title}</h2><p>{current.summary}</p><Link to={`/node/${current.id}?source=roaming`}>打开节点</Link></article>}
  </section>
}
