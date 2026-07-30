import { useEffect } from 'react'
import { useAppData } from '../data/app-data-context'

export function HomePage() {
  const { state } = useAppData()
  useEffect(() => { document.title = '万象回廊 · MyKr' }, [])

  return <section className="atlas-page"><p className="atlas-coordinate">ORIGIN / 00</p>
    <header className="site-header"><p className="site-kicker">Myriad Atlas · MyKr</p><h1 tabIndex={-1}>万象回廊 · MyKr</h1></header>
    {state.status === 'error' ? <section className="message-state" role="alert"><h2>内容无法加载</h2><p>{state.error.message}</p></section>
      : state.status === 'loading' ? <section className="message-state" aria-live="polite"><h2>正在加载知识航图</h2></section>
        : state.status === 'empty' ? <section className="message-state"><h2>内容库尚未导入</h2><p>应用和编译链已经准备就绪。</p></section>
          : <section className="message-state"><h2>知识节点已就绪</h2><p>当前共有 {state.data.catalog.nodes.length} 个节点。</p></section>}
  </section>
}
