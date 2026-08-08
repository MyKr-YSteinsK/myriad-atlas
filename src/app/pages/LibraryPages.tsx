import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAppData } from '../data/app-data-context'
import { courseNodes, courseStats, type CourseFilter, type CourseSort } from '../data/library-data'
import { useLocalStateSnapshot } from '../state/use-local-state'
import { PageHeader, StateMessage } from '../components/PageHeader'

export function LibraryPage() {
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  if (state.status === 'loading') return <section className="atlas-page"><h1 tabIndex={-1}>知识库</h1><p role="status">正在加载……</p></section>
  if (state.status === 'error') return <section className="atlas-page"><h1 tabIndex={-1}>知识库</h1><p role="alert">{state.error.message}</p></section>
  return <section className="atlas-page library-page"><PageHeader kicker="LIBRARY / CATALOG" title="知识库" summary="按领域与课程查阅正式知识索引。" actions={<Link className="atlas-primary-link" to="/map">打开知识地图</Link>} />
    {state.data.catalog.nodes.length === 0 && <StateMessage code="00" title="当前没有正式节点"><p>已登记领域仍保留在索引中。</p></StateMessage>}
    <ol className="domain-index">{state.data.taxonomy.domains.map((domain, index) => {
      const courseMetrics = domain.courses.map((course) => ({ course, stats: courseStats(state.data.catalog.nodes, local.nodeStates, course.id) }))
      const totals = courseMetrics.reduce((sum, entry) => ({ total: sum.total + entry.stats.total, completed: sum.completed + entry.stats.completed }), { total: 0, completed: 0 })
      const representative = courseMetrics.find((entry) => entry.stats.total > 0)?.course ?? domain.courses[0]
      return <li key={domain.id}><span>{String(index + 1).padStart(2, '0')}</span><div className="domain-entry"><header><h2><Link to={`/library/${domain.id}`}>{domain.name}</Link></h2><span>{totals.total ? Math.round(totals.completed / totals.total * 100) : 0}%</span></header><div className="domain-metrics"><span>{domain.courses.length} 课程</span><span>{totals.total} 节点</span><span>{totals.completed} 完成</span>{representative && <span>代表课程：{representative.name}</span>}</div>{domain.id === 'knowledge-roaming' && <p>用于随机发现的知识池。</p>}{domain.id === 'personal-qa' && <p>由个人问题链形成的正式解答库。</p>}<ul>{courseMetrics.map(({ course, stats }) => {
      return <li key={course.id}><Link to={`/library/${domain.id}/${course.id}`}>{course.name}</Link><span>{stats.total} 节点 · {stats.completed} 完成</span></li>
    })}</ul></div></li>})}</ol>
  </section>
}

export function DomainPage() {
  const { domainId = '' } = useParams()
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  if (state.status !== 'ready' && state.status !== 'empty') return <section className="atlas-page"><h1 tabIndex={-1}>领域</h1><p>正在加载……</p></section>
  const domain = state.data.taxonomy.domains.find((entry) => entry.id === domainId)
  if (!domain) return <section className="atlas-page"><h1 tabIndex={-1}>领域不存在</h1></section>
  const totals = domain.courses.map((course) => courseStats(state.data.catalog.nodes, local.nodeStates, course.id)).reduce((sum, stats) => ({ total: sum.total + stats.total, completed: sum.completed + stats.completed }), { total: 0, completed: 0 })
  return <section className="atlas-page library-page"><PageHeader variant="context" kicker={`DOMAIN / ${domain.id}`} title={domain.name} meta={<><strong>{domain.courses.length}</strong><span>课程 · {totals.total} 节点 · {totals.completed} 完成</span></>} /><ul className="course-index">{domain.courses.map((course, index) => {
    const stats = courseStats(state.data.catalog.nodes, local.nodeStates, course.id)
    return <li key={course.id}><span className="course-sequence">{String(index + 1).padStart(2, '0')}</span><div><h2><Link to={`/library/${domain.id}/${course.id}`}>{course.name}</Link></h2><p className="inline-metrics"><span>{stats.total} 节点</span><span>{stats.completed} 完成</span><span>{stats.favorite} 收藏</span><span>{stats.unknown} 不会</span></p>{stats.total === 0 && <p>该课程尚无正式节点。</p>}</div></li>
  })}</ul></section>
}

export function CoursePage() {
  const { domainId = '', courseId = '' } = useParams()
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  const [sort, setSort] = useState<CourseSort>('sequence')
  const [filter, setFilter] = useState<CourseFilter>('all')
  const [query, setQuery] = useState('')
  if (state.status !== 'ready' && state.status !== 'empty') return <section className="atlas-page"><h1 tabIndex={-1}>课程</h1><p>正在加载……</p></section>
  const domain = state.data.taxonomy.domains.find((entry) => entry.id === domainId)
  const course = domain?.courses.find((entry) => entry.id === courseId)
  if (!domain || !course) return <section className="atlas-page"><h1 tabIndex={-1}>课程不存在</h1></section>
  const nodes = courseNodes(state.data.catalog.nodes, local.nodeStates, { domainId, courseId, sort, filter, query })
  const states = new Map(local.nodeStates.map((entry) => [entry.node_id, entry]))
  const stats = courseStats(state.data.catalog.nodes, local.nodeStates, course.id)
  return <section className="atlas-page course-page"><PageHeader variant="context" kicker={`${domain.name} / ${course.id}`} title={course.name} meta={<><strong>{stats.completed} / {stats.total}</strong><span>已完成</span></>} />
    <div className="course-controls"><label>排序<select value={sort} onChange={(event) => setSort(event.target.value as CourseSort)}><option value="sequence">文件序号</option><option value="title">标题</option><option value="recent">最近阅读</option><option value="incomplete">未完成优先</option></select></label><label>当前课程筛选<input value={query} onChange={(event) => setQuery(event.target.value)} type="search" /></label></div>
    <div className="course-filters" aria-label="状态筛选">{(['all', 'favorite', 'unknown', 'incomplete'] as CourseFilter[]).map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{{ all: '全部', favorite: '收藏', unknown: '不会', incomplete: '未完成' }[value]}</button>)}</div>
    <p><Link to={`/search?course=${course.id}`}>在全文搜索中查找本课程</Link></p>
    {nodes.length === 0 && <StateMessage code="00" title="当前条件下没有节点"><p>尝试清除状态筛选或搜索词。</p></StateMessage>}
    <ol className="node-index">{nodes.map((node) => {
      const value = states.get(node.id)
      const ratio = value?.reading_progress?.ratio ?? 0
      return <li key={node.id}><span>{String(node.sequence).padStart(node.kind === 'roaming' || node.kind === 'qa' ? 4 : 2, '0')}</span><div><div className="node-meta"><span>{node.kind === 'normal' ? 'KNOWLEDGE' : node.kind.toUpperCase()}</span><span className="node-state-markers">{value?.completed && <i data-state="completed">完成</i>}{value?.favorite && <i data-state="favorite">收藏</i>}{value?.unknown && <i data-state="unknown">不会</i>}</span></div><h2><Link to={`/node/${node.id}?source=course&domain=${domain.id}&course=${course.id}`}>{node.title}</Link></h2><p>{node.summary}</p>{ratio > 0 && <div className="node-reading-progress"><span style={{ transform: `scaleX(${ratio})` }} /><small>阅读 {Math.round(ratio * 100)}%</small></div>}</div></li>
    })}</ol>
  </section>
}
