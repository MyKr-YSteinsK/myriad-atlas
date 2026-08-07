export type ContentVersionComparison = 'older' | 'equal' | 'newer'

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.2.0'
export const DATA_FORMAT_VERSION = typeof __DATA_FORMAT_VERSION__ === 'number' ? __DATA_FORMAT_VERSION__ : 1

export function parseContentVersion(value: string): { year: number; month: number; day: number; sequence: number } | undefined {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [year, month, day, sequence] = match.slice(1).map(Number)
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return undefined
  return { year, month, day, sequence }
}

export function compareContentVersions(active: string, candidate: string): ContentVersionComparison | undefined {
  const left = parseContentVersion(active)
  const right = parseContentVersion(candidate)
  if (!left || !right) return undefined
  if (active === candidate) return 'equal'
  const leftValue = (((left.year * 100) + left.month) * 100 + left.day) * 100 + left.sequence
  const rightValue = (((right.year * 100) + right.month) * 100 + right.day) * 100 + right.sequence
  return leftValue < rightValue ? 'older' : 'newer'
}
