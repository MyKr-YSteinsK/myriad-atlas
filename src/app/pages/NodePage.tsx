import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { RuntimeNode } from '../../content/types'
import { contentClient } from '../../lib/content-client'
import { ContentClientError } from '../../lib/errors'
import { ReaderPage } from '../reader/ReaderPage'

export function NodePage() {
  const { nodeId = '' } = useParams()
  const [node, setNode] = useState<RuntimeNode>()
  const [error, setError] = useState<{ nodeId: string; value: ContentClientError }>()
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    contentClient.loadNode(nodeId, controller.signal).then(setNode).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError({ nodeId, value: reason instanceof ContentClientError ? reason : new ContentClientError('application', '应用无法读取该节点。') })
    })
    return () => controller.abort()
  }, [nodeId, retry])

  if (error?.nodeId === nodeId) return <main className="app-shell"><section className="message-state" role="alert"><h1>节点无法加载</h1><p>{error.value.message}</p><button type="button" onClick={() => { setError(undefined); setRetry((value) => value + 1) }}>重试</button><Link to="/">返回知识航图</Link></section></main>
  if (!node || node.id !== nodeId) return <main className="app-shell"><section className="message-state" aria-live="polite"><h1>正在加载节点</h1><p>正在读取已编译的阅读内容。</p></section></main>
  return <ReaderPage node={node} catalog={contentClient.getCachedCatalog()} />
}
