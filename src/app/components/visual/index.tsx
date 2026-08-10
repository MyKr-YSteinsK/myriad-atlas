import type { CSSProperties, ReactNode } from 'react'

export type AtlasState = 'unread' | 'current' | 'completed' | 'favorite' | 'unknown' | 'roaming'
export type RouteRole = 'core' | 'optional' | 'synthesis'

const stateLabels: Record<AtlasState, string> = {
  unread: '未读',
  current: '当前阅读',
  completed: '已完成',
  favorite: '已收藏',
  unknown: '不会／追问',
  roaming: '漫游节点',
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value))
const classes = (...values: Array<string | undefined | false>): string => values.filter(Boolean).join(' ')

export function StateGlyph({ state, announce = true, label, className }: { state: AtlasState; announce?: boolean; label?: string; className?: string }) {
  const glyph = <span className={classes('state-glyph', className)} data-state={state} aria-hidden="true" />
  if (!announce) return glyph
  return <span className="state-glyph-with-label">{glyph}<span className="sr-only">{label ?? stateLabels[state]}</span></span>
}

export interface ProgressTrackProps {
  ratio: number
  label: string
  variant?: 'reading' | 'compact' | 'route'
  segments?: number
  currentIndex?: number
  completedSegments?: number
  roles?: readonly RouteRole[]
  className?: string
}

function routeMarkerState(index: number, count: number, currentIndex: number | undefined, completedSegments: number | undefined): 'completed' | 'current' | 'unread' {
  if (count === 0) return 'unread'
  const completed = clamp(completedSegments ?? 0, 0, count)
  if (currentIndex !== undefined && index === clamp(currentIndex, 0, count - 1) && completed < count) return 'current'
  return index < completed ? 'completed' : 'unread'
}

export function ProgressTrack({ ratio, label, variant = 'compact', segments = 0, currentIndex, completedSegments, roles, className }: ProgressTrackProps) {
  const safeRatio = clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1)
  const markerCount = clamp(Math.floor(segments), 0, 20)
  return <div className={classes('progress-track', 'progress-track-' + variant, className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={safeRatio} aria-valuetext={String(Math.round(safeRatio * 100)) + '%'} style={{ '--progress-ratio': String(safeRatio) } as CSSProperties}>
    <span className="progress-track-fill" aria-hidden="true" />
    {variant === 'route' && markerCount > 0 && <span className="progress-track-markers" aria-hidden="true" style={{ '--route-marker-count': String(markerCount) } as CSSProperties}>
      {Array.from({ length: markerCount }, (_, index) => <span key={index} data-testid="route-marker" className="progress-track-marker" data-state={routeMarkerState(index, markerCount, currentIndex, completedSegments)} data-role={roles?.[index] ?? 'core'} />)}
    </span>}
  </div>
}

export interface MiniRouteUnit { role?: RouteRole }

export function MiniRoute({ units, count, currentIndex, completed, label, className }: { units?: readonly MiniRouteUnit[]; count?: number; currentIndex?: number; completed?: number; label: string; className?: string }) {
  const total = clamp(units?.length ?? count ?? 0, 0, 20)
  const visibleCount = total > 12 ? 12 : total
  const completedCount = clamp(completed ?? 0, 0, total)
  const visibleRoles = Array.from({ length: visibleCount }, (_, index) => {
    if (!units?.length || visibleCount === total) return units?.[index]?.role ?? 'core'
    const sourceIndex = Math.round((index / Math.max(1, visibleCount - 1)) * (total - 1))
    return units[sourceIndex]?.role ?? 'core'
  })
  const visibleCompleted = total === 0 ? 0 : Math.round((completedCount / total) * visibleCount)
  const visibleCurrent = currentIndex === undefined || total < 2 ? undefined : Math.round((clamp(currentIndex, 0, total - 1) / (total - 1)) * Math.max(0, visibleCount - 1))
  const accessibleLabel = label + '，已完成 ' + String(completedCount) + ' / ' + String(total)
  return <div className={classes('mini-route', className)} data-density={total > visibleCount ? 'compressed' : 'full'}>
    <ProgressTrack ratio={total === 0 ? 0 : completedCount / total} label={accessibleLabel} variant="route" segments={visibleCount} currentIndex={visibleCurrent} completedSegments={visibleCompleted} roles={visibleRoles} />
  </div>
}

export function MetricBar({ value, max, label, tone = 'accent', showValue = true, className }: { value: number; max: number; label: ReactNode; tone?: 'accent' | 'success' | 'warning' | 'danger'; showValue?: boolean; className?: string }) {
  const safeMaximum = Math.max(0, Number.isFinite(max) ? max : 0)
  const safeValue = clamp(Number.isFinite(value) ? value : 0, 0, safeMaximum)
  const ratio = safeMaximum === 0 ? 0 : safeValue / safeMaximum
  const accessibleLabel = typeof label === 'string' ? label : '指标'
  return <div className={classes('metric-bar', className)} data-tone={tone} role="progressbar" aria-label={accessibleLabel} aria-valuemin={0} aria-valuemax={safeMaximum} aria-valuenow={safeValue} aria-valuetext={String(safeValue) + ' / ' + String(safeMaximum)}>
    <span className="metric-bar-label">{label}</span>
    <span className="metric-bar-track" aria-hidden="true"><span style={{ '--metric-ratio': String(ratio) } as CSSProperties} /></span>
    {showValue && <output>{safeValue}</output>}
  </div>
}

export interface MetricStripItem { id: string; label: ReactNode; value: number; max: number; tone?: 'accent' | 'success' | 'warning' | 'danger' }

export function MetricStrip({ items, label = '知识指标', className }: { items: readonly MetricStripItem[]; label?: string; className?: string }) {
  return <div className={classes('metric-strip', className)} role="group" aria-label={label}>
    {items.map((item) => <MetricBar key={item.id} value={item.value} max={item.max} label={item.label} tone={item.tone} />)}
  </div>
}

export interface AtlasMiniMapNode { id: string; label: string; state: AtlasState }

const mapSlots = [
  { x: 50, y: 10 },
  { x: 79, y: 25 },
  { x: 88, y: 62 },
  { x: 68, y: 90 },
  { x: 32, y: 90 },
  { x: 12, y: 62 },
  { x: 21, y: 25 },
]

const slotSelection: Record<number, number[]> = {
  1: [2],
  2: [0, 4],
  3: [0, 2, 5],
  4: [0, 2, 4, 6],
  5: [0, 1, 3, 5, 6],
  6: [0, 1, 2, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
}

export function AtlasMiniMap({ center, nodes, label, className }: { center?: AtlasMiniMapNode; nodes?: readonly AtlasMiniMapNode[]; label?: string; className?: string }) {
  const neighbours = (nodes ?? []).slice(0, 7)
  if (!center || neighbours.length === 0) return <div className={classes('atlas-mini-map', 'atlas-mini-map-empty', className)} role="img" aria-label={label ?? '暂无可展示的知识位置'}><span>暂无可展示的知识位置</span></div>
  const selection = slotSelection[neighbours.length] ?? slotSelection[7]
  const positioned = neighbours.map((node, index) => ({ node, position: mapSlots[selection[index]] }))
  const accessibleLabel = label ?? ('知识位置：中心 ' + center.label + '，关联 ' + neighbours.map((node) => node.label).join('、'))
  return <div className={classes('atlas-mini-map', className)} role="img" aria-label={accessibleLabel}>
    <svg className="atlas-mini-map-lines" aria-hidden="true" viewBox="0 0 320 200" preserveAspectRatio="none">
      {positioned.map(({ node, position }) => <line key={node.id} x1="160" y1="100" x2={String(position.x * 3.2)} y2={String(position.y * 2)} />)}
    </svg>
    <div className="atlas-mini-map-node atlas-mini-map-center" style={{ '--atlas-node-x': '50%', '--atlas-node-y': '50%' } as CSSProperties}><StateGlyph state={center.state} announce={false} /><span>{center.label}</span></div>
    {positioned.map(({ node, position }) => <div key={node.id} className="atlas-mini-map-node" style={{ '--atlas-node-x': String(position.x) + '%', '--atlas-node-y': String(position.y) + '%' } as CSSProperties}><StateGlyph state={node.state} announce={false} /><span>{node.label}</span></div>)}
  </div>
}
