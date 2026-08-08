import type { ReactNode } from 'react'

type PageHeaderProps = {
  variant?: 'display' | 'standard' | 'context'
  kicker?: ReactNode
  title: ReactNode
  summary?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ variant = 'standard', kicker, title, summary, meta, actions }: PageHeaderProps) {
  return <header className={`page-header page-header-${variant}`}>
    <div className="page-header-copy">
      {kicker && <p className="page-kicker">{kicker}</p>}
      <h1 tabIndex={-1}>{title}</h1>
      {summary && <p className="page-summary">{summary}</p>}
    </div>
    {(meta || actions) && <div className="page-header-aside">
      {meta && <div className="page-meta">{meta}</div>}
      {actions && <div className="page-actions">{actions}</div>}
    </div>}
  </header>
}

export function SectionHeader({ index, title, summary, action }: { index?: ReactNode; title: ReactNode; summary?: ReactNode; action?: ReactNode }) {
  return <header className="section-header">
    <div>{index && <p className="section-index">{index}</p>}<h2>{title}</h2>{summary && <p>{summary}</p>}</div>
    {action && <div className="section-action">{action}</div>}
  </header>
}

export function StateMessage({ code, title, children, action, tone = 'neutral' }: { code?: string; title: string; children?: ReactNode; action?: ReactNode; tone?: 'neutral' | 'error' | 'offline' }) {
  return <section className="state-message" data-tone={tone}>
    <span className="state-code" aria-hidden="true">{code ?? '—'}</span>
    <div><h2>{title}</h2>{children}{action && <div className="state-action">{action}</div>}</div>
  </section>
}
