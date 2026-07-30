import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { AppDataProvider } from './data/AppDataProvider'
import { ErrorBoundary } from './ErrorBoundary'
import { AppUpdateProvider } from '../pwa/AppUpdateProvider'

export function AppRouter() {
  return (
    <HashRouter><ErrorBoundary><AppUpdateProvider><AppDataProvider><App /></AppDataProvider></AppUpdateProvider></ErrorBoundary></HashRouter>
  )
}
