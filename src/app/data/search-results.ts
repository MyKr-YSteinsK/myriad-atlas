import type { CatalogRecord } from '../../content/types'
import type { SearchResult } from '../../lib/search-repository'
import type { NodeState } from '../state/reader-db'

export function filterSearchResults(
  results: SearchResult[],
  catalog: CatalogRecord[],
  states: NodeState[],
): { results: SearchResult[]; skipped: number } {
  const catalogIds = new Set(catalog.map((node) => node.id))
  const uninterested = new Set(states.filter((entry) => entry.uninterested).map((entry) => entry.node_id))
  let skipped = 0
  const filtered = results.filter((result) => {
    const nodeId = result.meta.node_id
    const valid = Boolean(nodeId) && catalogIds.has(nodeId) && !uninterested.has(nodeId)
    if (!valid) skipped += 1
    return valid
  })
  return { results: filtered, skipped }
}
