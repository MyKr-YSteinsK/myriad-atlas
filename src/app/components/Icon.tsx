import type { ReactNode } from 'react'

export type IconName =
  | 'home'
  | 'route'
  | 'library'
  | 'roam'
  | 'me'
  | 'search'
  | 'arrow-left'
  | 'toc'
  | 'settings'

const paths: Record<IconName, ReactNode> = {
  home: <><path d="M4 10.5 12 4l8 6.5" /><path d="M6.5 9.5V20h11V9.5M10 20v-6h4v6" /></>,
  route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h2.5a3 3 0 0 0 3-3v-6a3 3 0 0 1 3-3H16" /></>,
  library: <><path d="M5 4.5h5.5A2.5 2.5 0 0 1 13 7v13a3 3 0 0 0-3-3H5z" /><path d="M19 4.5h-3.5A2.5 2.5 0 0 0 13 7v13a3 3 0 0 1 3-3h3z" /></>,
  roam: <><path d="M4 7h3.5c4.5 0 4.5 10 9 10H20" /><path d="m17 14 3 3-3 3M4 17h3.5c1.6 0 2.7-1.3 3.7-3M13 9c1-1.2 2-2 3.5-2H20" /><path d="m17 4 3 3-3 3" /></>,
  me: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" /></>,
  'arrow-left': <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
  toc: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r=".75" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r=".75" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r=".75" fill="currentColor" stroke="none" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>,
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {paths[name]}
  </svg>
}
