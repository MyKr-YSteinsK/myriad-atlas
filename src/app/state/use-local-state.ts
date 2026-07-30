import { useEffect, useState, useSyncExternalStore } from 'react'
import { localState } from './local-state'
import type { NodeState, RoutePosition } from './reader-db'

export function useLocalStateSnapshot(): {
  nodeStates: NodeState[]
  routePositions: RoutePosition[]
  unavailable: boolean
} {
  const revision = useSyncExternalStore(localState.subscribe, localState.getRevision, localState.getRevision)
  const [value, setValue] = useState<{ nodeStates: NodeState[]; routePositions: RoutePosition[]; unavailable: boolean }>({
    nodeStates: [], routePositions: [], unavailable: false,
  })
  useEffect(() => {
    let active = true
    Promise.all([localState.listNodeStates(), localState.listRoutePositions()])
      .then(([nodeStates, routePositions]) => { if (active) setValue({ nodeStates, routePositions, unavailable: false }) })
      .catch(() => { if (active) setValue((current) => ({ ...current, unavailable: true })) })
    return () => { active = false }
  }, [revision])
  return value
}
