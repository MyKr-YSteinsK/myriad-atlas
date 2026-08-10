import type { AtlasState } from '../components/visual'

export interface HomeAtlasAnchor {
  kind: 'reading' | 'route' | 'origin'
  label: string
  state: AtlasState
}

export function resolveHomeAtlasAnchor(readingNodeId?: string, routeCode?: string): HomeAtlasAnchor {
  if (readingNodeId) return { kind: 'reading', label: 'CURRENT', state: 'current' }
  if (routeCode) return { kind: 'route', label: routeCode, state: 'current' }
  return { kind: 'origin', label: 'ORIGIN', state: 'unread' }
}

export function homeMetricScale(values: readonly number[]): number {
  return Math.max(1, ...values.map((value) => Number.isFinite(value) ? Math.max(0, value) : 0))
}
