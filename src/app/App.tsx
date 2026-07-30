import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { LibraryPage, MePage, RoamingPage } from './pages/MainPages'
import { RouteDetailPage, RoutesPage } from './pages/RoutePages'
import { NodePage } from './pages/NodePage'
import { AppLayout } from './layout/AppLayout'

const DevReaderPreview = import.meta.env.DEV ? lazy(() => import('./reader/dev/ReaderPreviewPage')) : undefined
const titles: Record<string, string> = {
  routes: '路线',
  library: '知识库',
  search: '全文搜索',
  roaming: '随机漫游',
  me: '我的',
  completed: '已读 / 已完成',
  favorites: '收藏',
  unknown: '不会 / 追问',
  questions: '问题链',
  'pending-removals': '待删除',
  opinions: '意见',
}

function PlaceholderPage({ title }: { title: string }) {
  return <main className="app-shell"><h1>{title}</h1><p>页面数据边界已就绪。</p></main>
}
function NotFoundPage() {
  return <main className="app-shell"><h1>页面不存在</h1><p>这个地址不在知识航图中。</p></main>
}

export function App() {
  return <Routes>
    <Route element={<AppLayout />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/routes" element={<RoutesPage />} />
      <Route path="/route/:routeId" element={<RouteDetailPage />} />
      <Route path="/library" element={<LibraryPage />} />
      <Route path="/library/:domainId" element={<PlaceholderPage title="领域" />} />
      <Route path="/library/:domainId/:courseId" element={<PlaceholderPage title="课程" />} />
      <Route path="/search" element={<PlaceholderPage title={titles.search} />} />
      <Route path="/roaming" element={<RoamingPage />} />
      <Route path="/me" element={<MePage />} />
      <Route path="/me/completed" element={<PlaceholderPage title={titles.completed} />} />
      <Route path="/me/favorites" element={<PlaceholderPage title={titles.favorites} />} />
      <Route path="/me/unknown" element={<PlaceholderPage title={titles.unknown} />} />
      <Route path="/me/questions" element={<PlaceholderPage title={titles.questions} />} />
      <Route path="/me/questions/:chainId" element={<PlaceholderPage title="问题链详情" />} />
      <Route path="/me/pending-removals" element={<PlaceholderPage title={titles['pending-removals']} />} />
      <Route path="/me/opinions" element={<PlaceholderPage title={titles.opinions} />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
    <Route path="/node/:nodeId" element={<NodePage />} />
    {DevReaderPreview && <Route path="/__reader-preview" element={<Suspense fallback={null}><DevReaderPreview /></Suspense>} />}
  </Routes>
}
