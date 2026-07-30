import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { CompletedPage, FavoritesPage, MePage, OpinionsPage, PendingRemovalsPage, UnknownPage } from './pages/MePages'
import { RoamingPage } from './pages/RoamingPage'
import { CoursePage, DomainPage, LibraryPage } from './pages/LibraryPages'
import { RouteDetailPage, RoutesPage } from './pages/RoutePages'
import { SearchPage } from './pages/SearchPage'
import { QuestionDetailPage, QuestionsPage } from './pages/QuestionPages'
import { NodePage } from './pages/NodePage'
import { AppLayout } from './layout/AppLayout'

const DevReaderPreview = import.meta.env.DEV ? lazy(() => import('./reader/dev/ReaderPreviewPage')) : undefined
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
      <Route path="/library/:domainId" element={<DomainPage />} />
      <Route path="/library/:domainId/:courseId" element={<CoursePage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/roaming" element={<RoamingPage />} />
      <Route path="/me" element={<MePage />} />
      <Route path="/me/completed" element={<CompletedPage />} />
      <Route path="/me/favorites" element={<FavoritesPage />} />
      <Route path="/me/unknown" element={<UnknownPage />} />
      <Route path="/me/questions" element={<QuestionsPage />} />
      <Route path="/me/questions/:chainId" element={<QuestionDetailPage />} />
      <Route path="/me/pending-removals" element={<PendingRemovalsPage />} />
      <Route path="/me/opinions" element={<OpinionsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
    <Route path="/node/:nodeId" element={<NodePage />} />
    {DevReaderPreview && <Route path="/__reader-preview" element={<Suspense fallback={null}><DevReaderPreview /></Suspense>} />}
  </Routes>
}
