import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAppData } from '../data/app-data-context'
import { courseNodes, courseStats, type CourseFilter, type CourseSort } from '../data/library-data'
import { useLocalStateSnapshot } from '../state/use-local-state'

export function LibraryPage() {
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  if (state.status === 'loading') return <section className="atlas-page"><h1 tabIndex={-1}>知识库</h1><p role="status">正在加载……</p></section>
  if (state.status === 'error') return <section className="atlas-page"><h1 tabIndex={-1}>知识库</h1><p role="alert">{state.error.message}</p></section>
  return <section className="atlas-page library-page"><p className="atlas-coordinate">LIBRARY / TAXONOMY</p><h1 tabIndex={-1}>知识库</h1><p><Link to="/map">打开知识地图</Link></p>
    {state.data.catalog.nodes.length === 0 && <div className="atlas-empty"><span>00</span><p>当前没有正式节点。已登记领域仍保留在索引中。</p></div>}
    <ol className="domain-index">{state.data.taxonomy.domains.map((domain, index) => <li key={domain.id}><span>{String(index + 1).padStart(2, '0')}</span><div><h2><Link to={`/library/${domain.id}`}>{domain.name}</Link></h2>{domain.id === 'knowledge-roaming' && <p>用于随机发现的知识池。</p>}{domain.id === 'personal-qa' && <p>由个人问题链形成的正式解答库。</p>}<ul>{domain.courses.map((course) => {
      const stats = courseStats(state.data.catalog.nodes, local.nodeStates, course.id)
      return <li key={course.id}><Link to={`/library/${domain.id}/${course.id}`}>{course.name}</Link><span>{stats.total} 节点 · {stats.completed} 完成</span></li>
    })}</ul></div></li>)}</ol>
  </section>
}

export function DomainPage() {
  const { domainId = '' } = useParams()
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  if (state.status !== 'ready' && state.status !== 'empty') return <section className="atlas-page"><h1 tabIndex={-1}>领域</h1><p>正在加载……</p></section>
  const domain = state.data.taxonomy.domains.find((entry) => entry.id === domainId)
  if (!domain) return <section className="atlas-page"><h1 tabIndex={-1}>领域不存在</h1></section>
  return <section className="atlas-page library-page"><p className="atlas-coordinate">DOMAIN / {domain.id}</p><h1 tabIndex={-1}>{domain.name}</h1><ul className="course-index">{domain.courses.map((course) => {
    const stats = courseStats(state.data.catalog.nodes, local.nodeStates, course.id)
    return <li key={course.id}><h2><Link to={`/library/${domain.id}/${course.id}`}>{course.name}</Link></h2><dl><div><dt>节点</dt><dd>{stats.total}</dd></div><div><dt>完成</dt><dd>{stats.completed}</dd></div><div><dt>收藏</dt><dd>{stats.favorite}</dd></div><div><dt>不会</dt><dd>{stats.unknown}</dd></div></dl>{stats.total === 0 && <p>该课程尚无正式节点。</p>}</li>
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
  return <section className="atlas-page course-page"><p className="atlas-coordinate">{domain.name} / {course.id}</p><h1 tabIndex={-1}>{course.name}</h1>
    <div className="course-controls"><label>排序<select value={sort} onChange={(event) => setSort(event.target.value as CourseSort)}><option value="sequence">文件序号</option><option value="title">标题</option><option value="recent">最近阅读</option><option value="incomplete">未完成优先</option></select></label><label>当前课程筛选<input value={query} onChange={(event) => setQuery(event.target.value)} type="search" /></label></div>
    <div className="course-filters" aria-label="状态筛选">{(['all', 'favorite', 'unknown', 'incomplete'] as CourseFilter[]).map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{{ all: '全部', favorite: '收藏', unknown: '不会', incomplete: '未完成' }[value]}</button>)}</div>
    <p><Link to={`/search?course=${course.id}`}>在全文搜索中查找本课程</Link></p>
    {nodes.length === 0 && <div className="atlas-empty"><span>00</span><p>当前条件下没有节点。</p></div>}
    <ol className="node-index">{nodes.map((node) => {
      const value = states.get(node.id)
      return <li key={node.id}><span>{String(node.sequence).padStart(node.kind === 'roaming' || node.kind === 'qa' ? 4 : 2, '0')}</span><div><p>{node.kind} {value?.completed ? '· 完成' : ''} {value?.favorite ? '· 收藏' : ''} {value?.unknown ? '· 不会' : ''}</p><h2><Link to={`/node/${node.id}?source=course&domain=${domain.id}&course=${course.id}`}>{node.title}</Link></h2><p>{node.summary}</p>{value?.reading_progress && <small>阅读 {Math.round(value.reading_progress.ratio * 100)}%</small>}</div></li>
    })}</ol>
  </section>
}
