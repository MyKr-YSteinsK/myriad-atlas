import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { CatalogRecord } from '../../content/types'
import { MetricBar, StateGlyph } from '../components/visual'
import { useAppData } from '../data/app-data-context'
import { pickRoaming, roamingEmptyReason, roamingPool } from '../data/roaming'
import { localState } from '../state/local-state'
import { useLocalStateSnapshot } from '../state/use-local-state'
import { PageHeader, StateMessage } from '../components/PageHeader'

const emptyMessages = {
  'no-content': '当前没有漫游内容。',
  'all-read': '全部漫游内容均已读。',
  'all-uninterested': '全部漫游内容均标记为不感兴趣。',
} as const

export function RoamingPage() {
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  const [current, setCurrent] = useState<CatalogRecord>()
  if (state.status !== 'ready' && state.status !== 'empty') return <section className="atlas-page"><h1 tabIndex={-1}>随机漫游</h1><p>正在加载…</p></section>
  const pool = roamingPool(state.data.catalog.nodes, local.nodeStates)
  const roamingTotal = state.data.catalog.nodes.filter((node) => node.kind === 'roaming').length
  const reason = roamingEmptyReason(state.data.catalog.nodes, local.nodeStates)
  const select = (): void => setCurrent(pickRoaming(pool, current?.id))
  return <section className="atlas-page roaming-page">
    <PageHeader variant="display" kicker="ROAM / RANDOM" title="随机漫游" meta={<span>{String(pool.length) + ' REMAINING'}</span>} />
    <MetricBar className="roaming-distribution" value={pool.length} max={roamingTotal} label="可漫游节点" tone="warning" />
    {reason && <StateMessage code="00" title={emptyMessages[reason]}>{reason === 'all-read' && <Link to="/me/completed">前往已读知识恢复</Link>}{reason === 'all-uninterested' && <Link to="/me/pending-removals">前往待删除撤销</Link>}</StateMessage>}
    {!reason && <div className="roaming-console"><div><StateGlyph state="roaming" /><span>POOL / {pool.length}</span></div><button className="roaming-pick" type="button" onClick={select}>{current ? '换一个' : '抽取一个节点'}</button></div>}
    {current && pool.some((entry) => entry.id === current.id) && <article className="roaming-current"><div className="roaming-current-mark"><StateGlyph state="roaming" /><p className="section-index">DISCOVERED / {String(current.sequence).padStart(4, '0')}</p></div><p>{current.domain_name + ' / ' + current.course_name}</p><h2>{current.title}</h2><p>{current.summary}</p><div className="roaming-actions"><Link to={'/node/' + current.id + '?source=roaming'}>阅读这个节点</Link><button type="button" onClick={select}>换一个</button><button type="button" onClick={() => { void localState.setUninterested(current.id, '').then(() => setCurrent(undefined)) }}>不感兴趣</button></div></article>}
  </section>
}
