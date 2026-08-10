import { describe, expect, it } from 'vitest'
import { homeMetricScale, resolveHomeAtlasAnchor } from '../../src/app/data/home-origin'

describe('home Atlas Origin data', () => {
  it('prioritizes recent reading, then recent route, then the empty origin', () => {
    expect(resolveHomeAtlasAnchor('node-1', 'LIGHT01')).toMatchObject({ kind: 'reading', label: 'CURRENT' })
    expect(resolveHomeAtlasAnchor(undefined, 'LIGHT01')).toMatchObject({ kind: 'route', label: 'LIGHT01' })
    expect(resolveHomeAtlasAnchor()).toMatchObject({ kind: 'origin', label: 'ORIGIN' })
  })

  it('keeps comparative metrics stable for empty and populated knowledge', () => {
    expect(homeMetricScale([])).toBe(1)
    expect(homeMetricScale([17, 3, 1, 6])).toBe(17)
    expect(homeMetricScale([-1, Number.NaN, 2])).toBe(2)
  })
})
