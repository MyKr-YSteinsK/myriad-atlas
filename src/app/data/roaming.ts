import type { CatalogRecord } from '../../content/types'
import type { NodeState } from '../state/reader-db'

export type EmptyRoamingReason = 'no-content' | 'all-read' | 'all-uninterested' | undefined
export interface RandomSource { getRandomValues(array: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer> }
export function roamingPool(catalog: CatalogRecord[], states: NodeState[]): CatalogRecord[] {
  const byId = new Map(states.map((state) => [state.node_id, state]))
  return catalog.filter((node) => node.kind === 'roaming')
    .filter((node) => !byId.get(node.id)?.completed && !byId.get(node.id)?.uninterested)
}
export function roamingEmptyReason(catalog: CatalogRecord[], states: NodeState[]): EmptyRoamingReason {
  const roaming = catalog.filter((node) => node.kind === 'roaming')
  if (roaming.length === 0) return 'no-content'
  if (roaming.every((node) => states.find((state) => state.node_id === node.id)?.uninterested)) return 'all-uninterested'
  if (roaming.every((node) => states.find((state) => state.node_id === node.id)?.completed
    || states.find((state) => state.node_id === node.id)?.uninterested)) return 'all-read'
  return undefined
}
export function secureRandomIndex(length: number, cryptoApi: RandomSource = crypto): number {
  if (!Number.isInteger(length) || length <= 0) throw new RangeError('length must be a positive integer')
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % length)
  const value = new Uint32Array(new ArrayBuffer(4))
  do cryptoApi.getRandomValues(value)
  while (value[0] >= limit)
  return value[0] % length
}
export function pickRoaming<T extends { id: string }>(values: T[], currentId?: string, cryptoApi?: RandomSource): T | undefined {
  const candidates = values.length > 1 ? values.filter((value) => value.id !== currentId) : values
  return candidates.length ? candidates[secureRandomIndex(candidates.length, cryptoApi)] : undefined
}
