import type { RuntimeRoute } from '../../content/types'

export interface RouteDetailResult { id: string; route?: RuntimeRoute; error?: string }

export async function loadRouteDetails(
  ids: string[],
  loadRoute: (id: string, signal?: AbortSignal) => Promise<RuntimeRoute>,
  signal?: AbortSignal,
): Promise<RouteDetailResult[]> {
  return Promise.all(ids.map(async (id) => {
    try {
      return { id, route: await loadRoute(id, signal) }
    } catch (error) {
      return { id, error: error instanceof Error ? error.message : '路线无法加载' }
    }
  }))
}
