import { Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { NodePage } from './pages/NodePage'

export function App() {
  return <Routes><Route path="/" element={<HomePage />} /><Route path="/node/:nodeId" element={<NodePage />} /><Route path="*" element={<HomePage />} /></Routes>
}
