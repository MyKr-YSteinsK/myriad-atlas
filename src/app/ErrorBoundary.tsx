import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State { return { hasError: true } }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application error boundary', error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <main className="app-shell"><section className="message-state" role="alert"><h1>应用暂时无法显示</h1><p>这是应用代码层错误，不会修改你的本地阅读数据。</p><button type="button" onClick={() => window.location.reload()}>重新加载</button></section></main>
    }
    return this.props.children
  }
}
