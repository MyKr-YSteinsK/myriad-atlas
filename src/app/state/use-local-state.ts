import { useEffect, useState, useSyncExternalStore } from 'react'
import { localState } from './local-state'
import type { LocalQuestionChain, NodeState, PendingRemoval, QuestionDraft, RoutePosition } from './reader-db'

export function useLocalStateSnapshot(): {
  nodeStates: NodeState[]
  routePositions: RoutePosition[]
  questionChains: LocalQuestionChain[]
  questionDrafts: QuestionDraft[]
  pendingRemovals: PendingRemoval[]
  unavailable: boolean
} {
  const revision = useSyncExternalStore(localState.subscribe, localState.getRevision, localState.getRevision)
  const [value, setValue] = useState<{
    nodeStates: NodeState[]
    routePositions: RoutePosition[]
    questionChains: LocalQuestionChain[]
    questionDrafts: QuestionDraft[]
    pendingRemovals: PendingRemoval[]
    unavailable: boolean
  }>({
    nodeStates: [], routePositions: [], questionChains: [], questionDrafts: [], pendingRemovals: [], unavailable: false,
  })
  useEffect(() => {
    let active = true
    Promise.all([
      localState.listNodeStates(), localState.listRoutePositions(), localState.listQuestionChains(),
      localState.listQuestionDrafts(), localState.listPendingRemovals(),
    ]).then(([nodeStates, routePositions, questionChains, questionDrafts, pendingRemovals]) => {
      if (active) setValue({ nodeStates, routePositions, questionChains, questionDrafts, pendingRemovals, unavailable: false })
    })
      .catch(() => { if (active) setValue((current) => ({ ...current, unavailable: true })) })
    return () => { active = false }
  }, [revision])
  return value
}
