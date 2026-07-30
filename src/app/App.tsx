import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { NodePage } from './pages/NodePage'

const DevReaderPreview = import.meta.env.DEV ? lazy(() => import('./reader/dev/ReaderPreviewPage')) : undefined

export function App() {
  return <Routes><Route path="/" element={<HomePage />} /><Route path="/node/:nodeId" element={<NodePage />} />{DevReaderPreview && <Route path="/__reader-preview" element={<Suspense fallback={null}><DevReaderPreview /></Suspense>} />}<Route path="*" element={<HomePage />} /></Routes>
}
