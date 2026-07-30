import type { CatalogRecord } from '../../content/types'
import type { NodeState } from '../state/reader-db'

export type CourseSort = 'sequence' | 'title' | 'recent' | 'incomplete'
export type CourseFilter = 'all' | 'favorite' | 'unknown' | 'incomplete'

export function courseNodes(
  records: CatalogRecord[],
  states: NodeState[],
  options: { domainId: string; courseId: string; sort: CourseSort; filter: CourseFilter; query: string },
): CatalogRecord[] {
  const stateById = new Map(states.map((state) => [state.node_id, state]))
  const query = options.query.trim().toLocaleLowerCase()
  const values = records.filter((record) => record.domain_id === options.domainId && record.course_id === options.courseId)
    .filter((record) => !stateById.get(record.id)?.uninterested)
    .filter((record) => {
      const state = stateById.get(record.id)
      if (options.filter === 'favorite') return Boolean(state?.favorite)
      if (options.filter === 'unknown') return Boolean(state?.unknown)
      if (options.filter === 'incomplete') return !state?.completed
      return true
    })
    .filter((record) => !query || [record.title, record.summary, ...record.takeaways, ...record.tags]
      .join(' ').toLocaleLowerCase().includes(query))
  return [...values].sort((left, right) => {
    const leftState = stateById.get(left.id)
    const rightState = stateById.get(right.id)
    if (options.sort === 'title') return left.title.localeCompare(right.title, 'zh-CN')
    if (options.sort === 'recent') return (rightState?.reading_progress?.updated_at ?? '').localeCompare(leftState?.reading_progress?.updated_at ?? '') || left.sequence - right.sequence
    if (options.sort === 'incomplete') return Number(Boolean(leftState?.completed)) - Number(Boolean(rightState?.completed)) || left.sequence - right.sequence
    return left.sequence - right.sequence || left.id.localeCompare(right.id)
  })
}

export function courseStats(records: CatalogRecord[], states: NodeState[], courseId: string) {
  const values = records.filter((record) => record.course_id === courseId)
  const stateById = new Map(states.map((state) => [state.node_id, state]))
  return {
    total: values.length,
    completed: values.filter((record) => stateById.get(record.id)?.completed).length,
    favorite: values.filter((record) => stateById.get(record.id)?.favorite).length,
    unknown: values.filter((record) => stateById.get(record.id)?.unknown).length,
  }
}
