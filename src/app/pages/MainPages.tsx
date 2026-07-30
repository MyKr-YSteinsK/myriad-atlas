import { useAppData } from '../data/app-data-context'

function StatePage({ title, emptyText }: { title: string; emptyText: string }) {
  const { state } = useAppData()
  return <section className="atlas-page"><p className="atlas-coordinate">INDEX / {title}</p><h1 tabIndex={-1}>{title}</h1>
    {state.status === 'loading' && <p role="status">正在读取知识航图……</p>}
    {state.status === 'error' && <p role="alert">内容暂时无法加载：{state.error.message}</p>}
    {state.status === 'empty' && <div className="atlas-empty"><span aria-hidden="true">00</span><p>{emptyText}</p></div>}
    {state.status === 'ready' && <p>内容数据已就绪。</p>}
  </section>
}

export function LibraryPage() { return <StatePage title="知识库" emptyText="当前没有正式节点。" /> }
export function RoamingPage() { return <StatePage title="随机漫游" emptyText="当前没有漫游内容。" /> }
export function MePage() { return <StatePage title="我的" emptyText="尚无个人状态。" /> }
