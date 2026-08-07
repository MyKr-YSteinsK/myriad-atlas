import { lazy, Suspense, type ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { CompletedPage, FavoritesPage, MePage, OpinionsPage, PendingRemovalsPage, UnknownPage } from './pages/MePages'
import { RoamingPage } from './pages/RoamingPage'
import { CoursePage, DomainPage, LibraryPage } from './pages/LibraryPages'
import { RouteDetailPage, RoutesPage } from './pages/RoutePages'
import { NodePage } from './pages/NodePage'
import { AppLayout } from './layout/AppLayout'
import { AppUpdateNotice } from '../pwa/AppUpdateNotice'

const DevReaderPreview = import.meta.env.DEV ? lazy(() => import('./reader/dev/ReaderPreviewPage')) : undefined
const SearchPage = lazy(async () => ({ default: (await import('./pages/SearchPage')).SearchPage }))
const KnowledgeMapPage = lazy(async () => ({ default: (await import('./pages/KnowledgeMapPage')).KnowledgeMapPage }))
const OfflinePage = lazy(async () => ({ default: (await import('./pages/OfflinePages')).OfflinePage }))
const VersionsPage = lazy(async () => ({ default: (await import('./pages/OfflinePages')).VersionsPage }))
const StoragePage = lazy(async () => ({ default: (await import('./pages/OfflinePages')).StoragePage }))
const BackupPage = lazy(async () => ({ default: (await import('./pages/OfflinePages')).BackupPage }))
const QuestionsPage = lazy(async () => ({ default: (await import('./pages/QuestionPages')).QuestionsPage }))
const QuestionDetailPage = lazy(async () => ({ default: (await import('./pages/QuestionPages')).QuestionDetailPage }))
function LazyRoute({ children }: { children: ReactNode }) { return <Suspense fallback={<section className="atlas-page"><p role="status">正在打开……</p></section>}>{children}</Suspense> }
function NotFoundPage() {
  return <main className="app-shell"><h1>页面不存在</h1><p>这个地址不在知识航图中。</p></main>
}

export function App() {
  return <><Routes>
    <Route element={<AppLayout />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/routes" element={<RoutesPage />} />
      <Route path="/route/:routeId" element={<RouteDetailPage />} />
      <Route path="/library" element={<LibraryPage />} />
      <Route path="/library/:domainId" element={<DomainPage />} />
      <Route path="/library/:domainId/:courseId" element={<CoursePage />} />
      <Route path="/search" element={<LazyRoute><SearchPage /></LazyRoute>} />
      <Route path="/roaming" element={<RoamingPage />} />
      <Route path="/map" element={<LazyRoute><KnowledgeMapPage /></LazyRoute>} />
      <Route path="/me" element={<MePage />} />
      <Route path="/me/completed" element={<CompletedPage />} />
      <Route path="/me/favorites" element={<FavoritesPage />} />
      <Route path="/me/unknown" element={<UnknownPage />} />
      <Route path="/me/questions" element={<LazyRoute><QuestionsPage /></LazyRoute>} />
      <Route path="/me/questions/:chainId" element={<LazyRoute><QuestionDetailPage /></LazyRoute>} />
      <Route path="/me/pending-removals" element={<PendingRemovalsPage />} />
      <Route path="/me/opinions" element={<OpinionsPage />} />
      <Route path="/me/offline" element={<LazyRoute><OfflinePage /></LazyRoute>} />
      <Route path="/me/versions" element={<LazyRoute><VersionsPage /></LazyRoute>} />
      <Route path="/me/storage" element={<LazyRoute><StoragePage /></LazyRoute>} />
      <Route path="/me/backups" element={<LazyRoute><BackupPage /></LazyRoute>} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
    <Route path="/node/:nodeId" element={<NodePage />} />
    {DevReaderPreview && <Route path="/__reader-preview" element={<Suspense fallback={null}><DevReaderPreview /></Suspense>} />}
  </Routes><AppUpdateNotice /></>
}
