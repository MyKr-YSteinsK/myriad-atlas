import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { RuntimeCatalog, RuntimeNode } from '../../content/types'
import { defaultReaderPreferences, loadReaderPreferences, saveReaderPreferences, type ReaderPreferences } from '../state/reader-db'
import { localState } from '../state/local-state'
import { ReaderSettings } from './ReaderSettings'
import { NodeActions } from './NodeActions'

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
  const [preferences, setPreferences] = useState<ReaderPreferences>(defaultReaderPreferences)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [anchor, setAnchor] = useState('')
  const [topBarVisible, setTopBarVisible] = useState(true)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const persistenceTimer = useRef<number | undefined>(undefined)
  const progressTimer = useRef<number | undefined>(undefined)
  const latestProgress = useRef({ ratio: 0, anchor: '' })
  const lastScrollY = useRef(0)
  const preferencesChanged = useRef(false)

  useEffect(() => {
    let active = true
    loadReaderPreferences().then((value) => { if (active && !preferencesChanged.current) setPreferences(value) }).catch(() => { if (active) setStorageWarning(true) })
    return () => { active = false }
  }, [])

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

  const updatePreferences = useCallback((patch: Partial<ReaderPreferences>) => {
    preferencesChanged.current = true
    setPreferences((current) => {
      const next = { ...current, ...patch }
      if (persistenceTimer.current) window.clearTimeout(persistenceTimer.current)
      persistenceTimer.current = window.setTimeout(() => {
        saveReaderPreferences(next).catch(() => setStorageWarning(true))
      }, 250)
      return next
    })
  }, [])

  const resetPreferences = useCallback(() => {
    updatePreferences(defaultReaderPreferences)
  }, [updatePreferences])

  useEffect(() => () => { if (persistenceTimer.current) window.clearTimeout(persistenceTimer.current) }, [])

  useEffect(() => {
    let active = true
    const tocIds = node.toc.map((entry) => entry.id)
    const flush = (): void => {
      if (progressTimer.current) {
        window.clearTimeout(progressTimer.current)
        progressTimer.current = undefined
      }
      const latest = latestProgress.current
      localState.saveReadingProgress(node.id, latest.ratio, latest.anchor, tocIds).catch(() => {
        if (active) setStorageWarning(true)
      })
    }
    localState.getNode(node.id).then((state) => {
      if (!active || !state?.reading_progress) return
      const saved = state.reading_progress
      window.requestAnimationFrame(() => {
        const target = saved.anchor ? document.getElementById(saved.anchor) : null
        if (target) target.scrollIntoView({ block: 'start' })
        else window.scrollTo({ top: saved.ratio * Math.max(0, document.documentElement.scrollHeight - window.innerHeight), behavior: 'auto' })
      })
    }).catch(() => { if (active) setStorageWarning(true) })

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
        flush()
      }, 800)
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    onScroll()
    return () => {
      active = false
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      flush()
    }
  }, [node.id, node.toc])

  const articleStyle = {
    '--reader-font-size': `${preferences.fontSize}px`,
    '--reader-line-height': String(preferences.lineHeight),
    '--reader-paragraph-spacing': `${preferences.paragraphSpacing}em`,
    '--reader-gutter': `${preferences.gutter}px`,
    '--reader-width': `${preferences.contentWidth}px`,
  } as CSSProperties
  const resolveReferences = (ids: string[], title: string) => ids.length > 0 && <section className="reader-references" aria-labelledby={`${title}-title`}><h2 id={`${title}-title`}>{title}</h2><ul>{ids.map((id) => {
    const record = catalog?.nodes.find((entry) => entry.id === id)
    return record ? <li key={id}><Link to={`/node/${id}`}>{record.title}</Link></li> : <li key={id} className="reader-data-error">构建异常：未在目录中找到节点 {id}</li>
  })}</ul></section>

  return <main className={`reader ${preferences.font === 'serif' ? 'reader-serif' : ''} ${preferences.codeWrap ? 'reader-code-wrap' : ''}`} style={articleStyle}>
    <header className={`reader-topbar ${topBarVisible ? '' : 'reader-topbar-hidden'}`}>
      <Link to="/" className="reader-back">返回知识航图</Link>
      <div className="reader-actions">{preferences.showToc && node.toc.length > 0 && <button type="button" onClick={() => document.getElementById('reader-toc')?.scrollIntoView({ block: 'start' })}>目录</button>}<button ref={settingsButton} type="button" onClick={() => setSettingsOpen(true)}>阅读设置</button></div>
      {preferences.showProgress && <div className="reader-progress" aria-label={`阅读进度 ${Math.round(progress * 100)}%`}><span style={{ transform: `scaleX(${progress})` }} /></div>}
    </header>
    <article className="reader-article">
      <header className="reader-title"><h1 ref={heading} tabIndex={-1}>{node.title}</h1><p>{node.summary}</p></header>
      {storageWarning && <p className="reader-storage-warning" role="status">本设备无法保存阅读设置或进度；阅读仍可正常进行。</p>}
      {preferences.showToc && node.toc.length > 0 && <nav id="reader-toc" className="reader-toc" aria-label="文章目录"><h2>目录</h2><ol>{node.toc.map((entry) => <li key={entry.id} data-active={anchor === entry.id}><button type="button" onClick={() => document.getElementById(entry.id)?.scrollIntoView({ block: 'start' })}>{entry.text}</button></li>)}</ol></nav>}
      <div className="reader-body" dangerouslySetInnerHTML={{ __html: node.body_html }} />
      <section className="reader-takeaways" aria-labelledby="takeaways-title"><h2 id="takeaways-title">要点</h2><ul>{node.takeaways.map((takeaway) => <li key={takeaway}>{takeaway}</li>)}</ul></section>
      {node.self_check.length > 0 && <section className="reader-self-check" aria-labelledby="self-check-title"><h2 id="self-check-title">自检</h2>{node.self_check.map((check) => <details key={check.question}><summary>{check.question}</summary><div dangerouslySetInnerHTML={{ __html: check.answer_html }} /></details>)}</section>}
      {resolveReferences(node.prerequisites, '前置节点')}
      {resolveReferences(node.related, '关联节点')}
      <NodeActions node={node} catalog={catalog} />
    </article>
    <ReaderSettings open={settingsOpen} preferences={preferences} onChange={updatePreferences} onReset={resetPreferences} onClose={() => setSettingsOpen(false)} triggerRef={settingsButton} />
  </main>
}
