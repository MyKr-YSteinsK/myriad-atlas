import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { RuntimeCatalog, RuntimeNode } from '../../content/types'
import { localState } from '../state/local-state'
import { ReaderSettings } from './ReaderSettings'
import { NodeActions } from './NodeActions'
import { useReaderPreferencePersistence } from './use-reader-preference-persistence'
import { useUpdateFlush } from '../../pwa/app-update-context'
import { Icon } from '../components/Icon'

interface ReaderPageProps { node: RuntimeNode; catalog?: RuntimeCatalog }

function scrollRatio(): number {
  const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  return maximum === 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / maximum))
}

function currentAnchor(toc: RuntimeNode['toc']): string {
  let current = ''
  for (const entry of toc) {
    const heading = document.getElementById(entry.id)
    if (heading && heading.getBoundingClientRect().top <= 108) current = entry.id
  }
  return current
}

export function ReaderPage({ node, catalog }: ReaderPageProps) {
  const location = useLocation()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [progressWarning, setProgressWarning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [anchor, setAnchor] = useState('')
  const [topBarVisible, setTopBarVisible] = useState(true)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const tocDisclosure = useRef<HTMLDetailsElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const progressTimer = useRef<number | undefined>(undefined)
  const latestProgress = useRef({ ratio: 0, anchor: '' })
  const progressFlush = useRef<() => Promise<void>>(async () => undefined)
  const lastScrollY = useRef(0)
  const { preferences, storageWarning, update: updatePreferences, reset: resetPreferences, flush: flushPreferences } = useReaderPreferencePersistence()
  const flushBeforeUpdate = useCallback(async () => {
    await flushPreferences()
    await progressFlush.current()
  }, [flushPreferences])
  useUpdateFlush(flushBeforeUpdate)

  useEffect(() => {
    document.title = `${node.title}｜万象回廊 · MyKr`
    heading.current?.focus()
  }, [node.id, node.title])

  useEffect(() => {
    const root = document.documentElement
    if (preferences.theme === 'system') delete root.dataset.theme
    else root.dataset.theme = preferences.theme
    return () => { delete root.dataset.theme }
  }, [preferences.theme])

  useEffect(() => {
    let active = true
    const tocIds = node.toc.map((entry) => entry.id)
    const flush = async (): Promise<void> => {
      if (progressTimer.current) {
        window.clearTimeout(progressTimer.current)
        progressTimer.current = undefined
      }
      const latest = latestProgress.current
      try {
        await localState.saveReadingProgress(node.id, latest.ratio, latest.anchor, tocIds)
      } catch (reason) {
        if (active) setProgressWarning(true)
        throw reason
      }
    }
    progressFlush.current = flush
    localState.getNode(node.id).then((state) => {
      if (!active || !state?.reading_progress) return
      const saved = state.reading_progress
      window.requestAnimationFrame(() => {
        const target = saved.anchor ? document.getElementById(saved.anchor) : null
        if (target) target.scrollIntoView({ block: 'start' })
        else window.scrollTo({ top: saved.ratio * Math.max(0, document.documentElement.scrollHeight - window.innerHeight), behavior: 'auto' })
      })
    }).catch(() => { if (active) setProgressWarning(true) })

    const onScroll = (): void => {
      const y = window.scrollY
      const nextAnchor = currentAnchor(node.toc)
      const nextRatio = scrollRatio()
      latestProgress.current = { ratio: nextRatio, anchor: nextAnchor }
      setProgress(nextRatio)
      setAnchor(nextAnchor)
      if (y < 80 || y < lastScrollY.current - 24) setTopBarVisible(true)
      else if (y > lastScrollY.current + 24) setTopBarVisible(false)
      lastScrollY.current = y
      if (progressTimer.current) return
      progressTimer.current = window.setTimeout(() => {
        progressTimer.current = undefined
        void flush().catch(() => undefined)
      }, 800)
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') void flush().catch(() => undefined)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    const flushOnPageHide = (): void => { void flush().catch(() => undefined) }
    window.addEventListener('pagehide', flushOnPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    onScroll()
    return () => {
      active = false
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', flushOnPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void flush().catch(() => undefined)
    }
  }, [node.id, node.toc])

  const articleStyle = {
    '--reader-font-size': `${preferences.fontSize}px`,
    '--reader-line-height': String(preferences.lineHeight),
    '--reader-paragraph-spacing': `${preferences.paragraphSpacing}em`,
    '--reader-gutter': `${preferences.gutter}px`,
    '--reader-width': `${preferences.contentWidth}px`,
  } as CSSProperties
  const parameters = new URLSearchParams(location.search)
  const source = parameters.get('source')
  const mapReturn = parameters.get('map') === '1' ? `/map?${new URLSearchParams([...parameters].filter(([key]) => key !== 'map')).toString()}` : undefined
  const returnContext = mapReturn ? { to: mapReturn, label: '返回航图' }
    : source === 'route' && parameters.get('route') ? { to: `/route/${parameters.get('route')}`, label: '返回路线' }
      : source === 'course' && parameters.get('domain') && parameters.get('course') ? { to: `/library/${parameters.get('domain')}/${parameters.get('course')}`, label: '返回课程' }
        : source === 'roaming' ? { to: '/roaming', label: '返回漫游' }
          : source === 'search' ? { to: '/search', label: '返回搜索' }
            : { to: '/', label: '返回首页' }
  const references = [
    ...node.prerequisites.map((id) => ({ id, relation: 'PREREQUISITE', label: '前置' })),
    ...node.related.map((id) => ({ id, relation: 'RELATED', label: '关联' })),
  ]
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  return <main className={`reader ${preferences.font === 'serif' ? 'reader-serif' : ''} ${preferences.codeWrap ? 'reader-code-wrap' : ''}`} style={articleStyle}>
    <header className={`reader-topbar ${topBarVisible ? '' : 'reader-topbar-hidden'}`}>
      <Link to={returnContext.to} className="reader-back"><Icon name="arrow-left" /><span>{returnContext.label}</span></Link>
      <p className="reader-topbar-title" data-visible={progress > .02}>{node.title}</p>
      <div className="reader-actions">{preferences.showToc && node.toc.length > 0 && <button type="button" aria-label="目录" onClick={() => { if (tocDisclosure.current) tocDisclosure.current.open = true; document.getElementById('reader-toc')?.scrollIntoView({ block: 'start' }) }}><Icon name="toc" /><span className="sr-only">目录</span></button>}<button ref={settingsButton} type="button" aria-label="阅读设置" onClick={() => setSettingsOpen(true)}><Icon name="settings" /><span className="sr-only">阅读设置</span></button></div>
      {preferences.showProgress && <div className="reader-progress" aria-label={`阅读进度 ${Math.round(progress * 100)}%`}><span style={{ transform: `scaleX(${progress})` }} /></div>}
    </header>
    <article className="reader-article">
      <header className="reader-title"><p className="reader-context">{node.domain_name} / {node.course_name}</p><h1 ref={heading} tabIndex={-1}>{node.title}</h1><p className="reader-summary">{node.summary}</p><div className="reader-title-meta"><span>{String(node.sequence).padStart(node.sequence >= 100 ? 4 : 2, '0')}</span><span>{node.qa ? 'QUESTION' : node.domain_id === 'knowledge-roaming' ? 'ROAMING' : 'KNOWLEDGE'}</span>{node.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div></header>
      {(storageWarning || progressWarning) && <p className="reader-storage-warning" role="status">本设备无法保存阅读设置或进度；阅读仍可正常进行。</p>}
      <div className="reader-content-grid">
        {preferences.showToc && node.toc.length > 0 && <nav id="reader-toc" className="reader-toc" aria-label="文章目录"><details ref={tocDisclosure}><summary>本文目录 <span>{node.toc.length} 节</span></summary><ol>{node.toc.map((entry) => <li key={entry.id} data-depth={entry.depth} data-active={anchor === entry.id}><button type="button" onClick={() => document.getElementById(entry.id)?.scrollIntoView({ block: 'start' })}>{entry.text}</button></li>)}</ol></details></nav>}
        <div className="reader-main-column">
          <div className="reader-body" dangerouslySetInnerHTML={{ __html: node.body_html }} />
          <section className="reader-takeaways" aria-labelledby="takeaways-title"><p className="reader-section-label">RECAP</p><h2 id="takeaways-title">要点回收</h2><ol>{node.takeaways.map((takeaway, index) => <li key={takeaway}><span>{String(index + 1).padStart(2, '0')}</span><p>{takeaway}</p></li>)}</ol></section>
          {node.self_check.length > 0 && <section className="reader-self-check" aria-labelledby="self-check-title"><p className="reader-section-label">SELF CHECK</p><h2 id="self-check-title">自检</h2>{node.self_check.map((check, index) => <details key={check.question}><summary><span>{String(index + 1).padStart(2, '0')}</span>{check.question}</summary><div dangerouslySetInnerHTML={{ __html: check.answer_html }} /></details>)}</section>}
          {references.length > 0 && <section className="reader-references" aria-labelledby="references-title"><p className="reader-section-label">REFERENCE</p><h2 id="references-title">参考与关联</h2><ul>{references.map(({ id, relation, label }) => {
            const record = catalog?.nodes.find((entry) => entry.id === id)
            return record ? <li key={`${relation}-${id}`}><span>{label}</span><div><Link to={`/node/${id}`}>{record.title}</Link><small>{record.course_name} / {record.sequence}</small></div></li> : <li key={`${relation}-${id}`} className="reader-data-error">构建异常：未在目录中找到节点 {id}</li>
          })}</ul></section>}
          <NodeActions node={node} catalog={catalog} />
        </div>
      </div>
    </article>
    <ReaderSettings open={settingsOpen} preferences={preferences} onChange={updatePreferences} onReset={resetPreferences} onClose={closeSettings} triggerRef={settingsButton} />
  </main>
}
