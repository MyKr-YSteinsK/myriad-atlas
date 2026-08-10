import type { RuntimeRouteUnit } from '../../content/types'
import type { MiniRouteUnit, RouteRole } from '../components/visual'
import type { RoutePosition } from '../state/reader-db'

type RouteVisualSource = Pick<RuntimeRouteUnit, 'node_id'> & { role?: RuntimeRouteUnit['role'] }

function visualRouteRole(role: RouteVisualSource['role'] | undefined): RouteRole {
  return role === 'anchor' ? 'synthesis' : role ?? 'core'
}

export function buildRouteVisualUnits(
  units: readonly RouteVisualSource[],
  completed: ReadonlySet<string>,
  position: Pick<RoutePosition, 'node_id'> | undefined,
): MiniRouteUnit[] {
  return units.map((unit) => {
    const isCompleted = completed.has(unit.node_id)
    return {
      role: visualRouteRole(unit.role),
      completed: isCompleted,
      state: position?.node_id === unit.node_id ? 'current' : isCompleted ? 'completed' : 'unread',
    }
  })
}

export function routePositionIndex(units: readonly Pick<RouteVisualSource, 'node_id'>[], position: Pick<RoutePosition, 'node_id'> | undefined): number | undefined {
  const index = position ? units.findIndex((unit) => unit.node_id === position.node_id) : -1
  return index >= 0 ? index : undefined
}
