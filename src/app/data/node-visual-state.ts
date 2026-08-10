import type { AtlasState } from '../components/visual'
import type { NodeState } from '../state/reader-db'

export function nodeVisualState(state: Pick<NodeState, 'completed' | 'favorite' | 'unknown' | 'reading_progress'> | undefined, kind: 'normal' | 'anchor' | 'roaming' | 'qa'): AtlasState {
  if (state?.completed) return 'completed'
  if (state?.unknown) return 'unknown'
  if ((state?.reading_progress?.ratio ?? 0) > 0) return 'current'
  if (state?.favorite) return 'favorite'
  if (kind === 'roaming') return 'roaming'
  return 'unread'
}
