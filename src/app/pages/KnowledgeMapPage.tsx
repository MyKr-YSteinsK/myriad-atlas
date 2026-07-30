import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { RuntimeKnowledgeMap } from '../../content/types'
import { contentRepository } from '../../lib/content-client'

export function KnowledgeMapPage() {
  const [map, setMap] = useState<RuntimeKnowledgeMap>(); const [error, setError] = useState<string>(); const [params, setParams] = useSearchParams()
  const domain = params.get('domain') ?? ''
  useEffect(() => { const controller = new AbortController(); void contentRepository.loadKnowledgeMap(controller.signal).then(setMap).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '知识地图无法加载')); return () => controller.abort() }, [])
  const nodes = useMemo(() => map?.nodes.filter((node) => !domain || node.domain_id === domain) ?? [], [domain, map])
  if (error) return <section className="atlas-page"><h1 tabIndex={-1}>知识地图</h1><p role="alert">{error}</p></section>
  if (!map) return <section className="atlas-page"><h1 tabIndex={-1}>知识地图</h1><p role="status">正在加载……</p></section>
  return <section className="atlas-page knowledge-map-page"><p className="atlas-coordinate">MAP / KNOWLEDGE</p><h1 tabIndex={-1}>知识地图</h1><label>领域筛选<select value={domain} onChange={(event) => setParams(event.target.value ? { domain: event.target.value } : {})}><option value="">全部领域</option>{map.domains.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>{nodes.length === 0 ? <div className="atlas-empty"><span>00</span><p>当前地图没有可显示节点。</p></div> : <ol className="knowledge-map-list">{nodes.map((node) => <li key={node.id}><span>{String(node.sequence).padStart(2, '0')}</span><div><p>{node.domain_id} / {node.course_id} · {node.kind}</p><Link to={`/node/${node.id}?map=1`}>{node.id}</Link></div></li>)}</ol>}<p className="knowledge-map-meta">版本 {map.content_version} · {map.edges.length} 条关系</p></section>
}
