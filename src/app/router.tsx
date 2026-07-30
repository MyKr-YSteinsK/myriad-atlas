import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { AppDataProvider } from './data/AppDataProvider'
import { ErrorBoundary } from './ErrorBoundary'

export function AppRouter() {
  return (
    <HashRouter><ErrorBoundary><AppDataProvider><App /></AppDataProvider></ErrorBoundary></HashRouter>
  )
}
