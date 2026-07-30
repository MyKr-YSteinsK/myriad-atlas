import type { RuntimeRoute, RuntimeRouteUnit } from '../../content/types'
import type { RoutePosition } from '../state/reader-db'

export interface RouteTarget {
  unit: RuntimeRouteUnit
  stageId: string
  stageName: string
  moduleId: string
  moduleName: string
}

export function routeTargets(route: RuntimeRoute): RouteTarget[] {
  return route.stages.flatMap((stage) => stage.modules.flatMap((module) => module.units
    .filter((unit) => unit.role === 'core' || unit.role === 'anchor')
    .sort((left, right) => left.order - right.order)
    .map((unit) => ({
      unit, stageId: stage.id, stageName: stage.name, moduleId: module.id, moduleName: module.name,
    }))))
}
export function routeProgress(route: RuntimeRoute, completed: Set<string>): { completed: number; total: number; ratio: number } {
  const targets = routeTargets(route)
  const done = targets.filter((target) => completed.has(target.unit.node_id)).length
  return { completed: done, total: targets.length, ratio: targets.length ? done / targets.length : 0 }
}
export function continueRoute(route: RuntimeRoute, completed: Set<string>, position?: RoutePosition): RouteTarget | undefined {
  const targets = routeTargets(route)
  if (position) {
    const currentIndex = targets.findIndex((target) => target.stageId === position.stage_id
      && target.moduleId === position.module_id && target.unit.node_id === position.node_id)
    if (currentIndex >= 0 && !completed.has(targets[currentIndex].unit.node_id)) return targets[currentIndex]
    if (currentIndex >= 0) return targets.slice(currentIndex + 1).find((target) => !completed.has(target.unit.node_id))
  }
  return targets.find((target) => !completed.has(target.unit.node_id))
}
