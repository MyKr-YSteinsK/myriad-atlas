import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MetricBar, ProgressTrack, StateGlyph } from '../components/visual'
import { useAppData } from '../data/app-data-context'
import { courseNodes, courseStats, type CourseFilter, type CourseSort } from '../data/library-data'
import { nodeVisualState } from '../data/node-visual-state'
import { useLocalStateSnapshot } from '../state/use-local-state'
import { PageHeader, StateMessage } from '../components/PageHeader'

const specialCourseNote = (domainId: string): string | undefined => {
  if (domainId === 'knowledge-roaming') return '用于随机发现的知识池。'
  if (domainId === 'personal-qa') return '由个人问题链形成的正式解答库。'
  return undefined
}

function courseStateGlyphs(stats: ReturnType<typeof courseStats>) {
  const unread = Math.max(0, stats.total - stats.completed)
  return <div className="course-state-strip" aria-label={'课程状态：' + String(stats.completed) + ' 已完成，' + String(stats.favorite) + ' 已收藏，' + String(stats.unknown) + ' 不会'}>
    {stats.completed > 0 && <StateGlyph state="completed" label={String(stats.completed) + ' 个已完成'} />}
    {stats.favorite > 0 && <StateGlyph state="favorite" label={String(stats.favorite) + ' 个已收藏'} />}
    {stats.unknown > 0 && <StateGlyph state="unknown" label={String(stats.unknown) + ' 个不会'} />}
    {unread > 0 && <StateGlyph state="unread" label={String(unread) + ' 个未完成'} />}
  </div>
}

export function LibraryPage() {
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  if (state.status === 'loading') return <section className="atlas-page"><h1 tabIndex={-1}>知识库</h1><p role="status">正在加载…</p></section>
  if (state.status === 'error') return <section className="atlas-page"><h1 tabIndex={-1}>知识库</h1><p role="alert">{state.error.message}</p></section>
  return <section className="atlas-page library-page">
    <PageHeader kicker="LIBRARY / CATALOG" title="知识库" actions={<Link className="atlas-primary-link" to="/map">打开知识地图</Link>} />
    {state.data.catalog.nodes.length === 0 && <StateMessage code="00" title="当前没有正式节点"><p>已登记领域仍保留在索引中。</p></StateMessage>}
    <ol className="domain-index">
      {state.data.taxonomy.domains.map((domain, index) => {
        const courseMetrics = domain.courses.map((course) => ({ course, stats: courseStats(state.data.catalog.nodes, local.nodeStates, course.id) }))
        const totals = courseMetrics.reduce((sum, entry) => ({ total: sum.total + entry.stats.total, completed: sum.completed + entry.stats.completed }), { total: 0, completed: 0 })
        return <li key={domain.id}>
          <span className="domain-sequence">{String(index + 1).padStart(2, '0')}</span>
          <div className="domain-entry">
            <header>
              <h2><Link to={'/library/' + domain.id}>{domain.name}</Link></h2>
              <output aria-label={'完成 ' + String(totals.completed) + ' / ' + String(totals.total)}>{totals.total ? Math.round(totals.completed / totals.total * 100) : 0}%</output>
            </header>
            <MetricBar value={totals.completed} max={totals.total} label={String(totals.total) + ' NODES'} tone="success" />
            {specialCourseNote(domain.id) && <p className="domain-special-note">{specialCourseNote(domain.id)}</p>}
            <ul className="domain-course-distribution">
              {courseMetrics.map(({ course, stats }) => <li key={course.id}>
                <Link to={'/library/' + domain.id + '/' + course.id}>{course.name}</Link>
                <MetricBar value={stats.total} max={Math.max(1, totals.total)} label={course.name} showValue />
              </li>)}
            </ul>
          </div>
        </li>
      })}
    </ol>
  </section>
}

export function DomainPage() {
  const { domainId = '' } = useParams()
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  if (state.status !== 'ready' && state.status !== 'empty') return <section className="atlas-page"><h1 tabIndex={-1}>领域</h1><p>正在加载…</p></section>
  const domain = state.data.taxonomy.domains.find((entry) => entry.id === domainId)
  if (!domain) return <section className="atlas-page"><h1 tabIndex={-1}>领域不存在</h1></section>
  const statsByCourse = domain.courses.map((course) => ({ course, stats: courseStats(state.data.catalog.nodes, local.nodeStates, course.id) }))
  const totals = statsByCourse.reduce((sum, entry) => ({ total: sum.total + entry.stats.total, completed: sum.completed + entry.stats.completed }), { total: 0, completed: 0 })
  return <section className="atlas-page library-page domain-page">
    <PageHeader variant="context" kicker={'DOMAIN / ' + domain.id} title={domain.name} meta={<span>{String(totals.total) + ' NODES'}</span>} />
    <MetricBar className="domain-total-progress" value={totals.completed} max={totals.total} label="已完成" tone="success" />
    <ul className="course-index">
      {statsByCourse.map(({ course, stats }, index) => <li key={course.id}>
        <span className="course-sequence">{String(index + 1).padStart(2, '0')}</span>
        <div>
          <header>
            <h2><Link to={'/library/' + domain.id + '/' + course.id}>{course.name}</Link></h2>
            <output>{stats.total}</output>
          </header>
          {courseStateGlyphs(stats)}
          <MetricBar value={stats.completed} max={stats.total} label="完成" tone="success" />
          {stats.total === 0 && <p className="course-empty-note">该课程尚无正式节点。</p>}
        </div>
      </li>)}
    </ul>
  </section>
}

const filterLabels: Record<CourseFilter, string> = {
  all: '全部',
  favorite: '收藏',
  unknown: '不会',
  incomplete: '未完成',
}

const filterGlyphs = {
  all: 'unread',
  favorite: 'favorite',
  unknown: 'unknown',
  incomplete: 'current',
} as const

export function CoursePage() {
  const { domainId = '', courseId = '' } = useParams()
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  const [sort, setSort] = useState<CourseSort>('sequence')
  const [filter, setFilter] = useState<CourseFilter>('all')
  const [query, setQuery] = useState('')
  if (state.status !== 'ready' && state.status !== 'empty') return <section className="atlas-page"><h1 tabIndex={-1}>课程</h1><p>正在加载…</p></section>
  const domain = state.data.taxonomy.domains.find((entry) => entry.id === domainId)
  const course = domain?.courses.find((entry) => entry.id === courseId)
  if (!domain || !course) return <section className="atlas-page"><h1 tabIndex={-1}>课程不存在</h1></section>
  const nodes = courseNodes(state.data.catalog.nodes, local.nodeStates, { domainId, courseId, sort, filter, query })
  const states = new Map(local.nodeStates.map((entry) => [entry.node_id, entry]))
  const stats = courseStats(state.data.catalog.nodes, local.nodeStates, course.id)
  const filterCounts: Record<CourseFilter, number> = {
    all: stats.total,
    favorite: stats.favorite,
    unknown: stats.unknown,
    incomplete: Math.max(0, stats.total - stats.completed),
  }
  return <section className="atlas-page course-page">
    <PageHeader variant="context" kicker={domain.name + ' / ' + course.id} title={course.name} meta={<span>{String(stats.total) + ' NODES'}</span>} />
    <MetricBar className="course-total-progress" value={stats.completed} max={stats.total} label="已完成" tone="success" />
    <div className="course-toolbar">
      <label>排序<select value={sort} onChange={(event) => setSort(event.target.value as CourseSort)}><option value="sequence">文件序号</option><option value="title">标题</option><option value="recent">最近阅读</option><option value="incomplete">未完成优先</option></select></label>
      <label>当前课程筛选<input value={query} onChange={(event) => setQuery(event.target.value)} type="search" /></label>
    </div>
    <div className="course-filters" aria-label="状态筛选">
      {(['all', 'favorite', 'unknown', 'incomplete'] as CourseFilter[]).map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
        <StateGlyph state={filterGlyphs[value]} announce={false} />
        <span>{filterLabels[value]}</span>
        <output>{filterCounts[value]}</output>
      </button>)}
    </div>
    <p className="course-search-link"><Link to={'/search?course=' + course.id}>在全文搜索中查找本课程</Link></p>
    {nodes.length === 0 && <StateMessage code="00" title="当前条件下没有节点"><p>尝试清除状态筛选或搜索词。</p></StateMessage>}
    <ol className="node-index">
      {nodes.map((node) => {
        const value = states.get(node.id)
        const ratio = value?.reading_progress?.ratio ?? 0
        return <li key={node.id}>
          <span className="node-sequence">{String(node.sequence).padStart(node.kind === 'roaming' || node.kind === 'qa' ? 4 : 2, '0')}</span>
          <StateGlyph state={nodeVisualState(value, node.kind)} />
          <div>
            <div className="node-meta"><span>{node.kind === 'normal' ? 'KNOWLEDGE' : node.kind.toUpperCase()}</span>{ratio > 0 && <output>{String(Math.round(ratio * 100)) + '%'}</output>}</div>
            <h2><Link to={'/node/' + node.id + '?source=course&domain=' + domain.id + '&course=' + course.id}>{node.title}</Link></h2>
            <ProgressTrack ratio={ratio} label={node.title + ' 阅读进度'} variant="reading" />
            <p>{node.summary}</p>
          </div>
        </li>
      })}
    </ol>
  </section>
}
