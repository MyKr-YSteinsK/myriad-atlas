import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { ErrorBoundary } from './ErrorBoundary'

export function AppRouter() {
  return (
    <HashRouter><ErrorBoundary><App /></ErrorBoundary></HashRouter>
  )
}
