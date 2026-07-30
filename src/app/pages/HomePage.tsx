import { useEffect, useState } from 'react'
import type { RuntimeCatalog } from '../../content/types'
import { contentClient } from '../../lib/content-client'
import { ContentClientError } from '../../lib/errors'

export function HomePage() {
  const [catalog, setCatalog] = useState<RuntimeCatalog>()
  const [error, setError] = useState<ContentClientError>()
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    contentClient.loadCatalog(controller.signal).then(setCatalog).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof ContentClientError ? reason : new ContentClientError('application', '应用无法读取内容目录。'))
    })
    return () => controller.abort()
  }, [retry])

  useEffect(() => { document.title = '万象回廊 · MyKr' }, [])

  return <main className="app-shell" tabIndex={-1}>
    <header className="site-header"><p className="site-kicker">Myriad Atlas · MyKr</p><h1>万象回廊 · MyKr</h1></header>
    {error ? <section className="message-state" role="alert"><h2>内容无法加载</h2><p>{error.message}</p><button type="button" onClick={() => { setError(undefined); setRetry((value) => value + 1) }}>重试</button></section>
      : !catalog ? <section className="message-state" aria-live="polite"><h2>正在加载知识航图</h2><p>正在读取已编译的内容目录。</p></section>
        : catalog.nodes.length === 0 ? <section className="message-state"><h2>当前没有正式知识</h2><p>内容库为空，但应用和编译链已准备就绪。</p></section>
          : <section className="message-state"><h2>知识节点已就绪</h2><p>当前共有 {catalog.nodes.length} 个节点。</p></section>}
  </main>
}
