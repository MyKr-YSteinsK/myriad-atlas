import { describe, expect, it, vi } from 'vitest'
import { loadRouteDetails } from '../../src/app/data/route-details'
import type { RuntimeRoute } from '../../src/content/types'

const route = { schema_version: 1, content_version: 'v', id: 'one', code: 'R1', name: '路线一', summary: '', core_anchor_count: 0, stages: [] } as RuntimeRoute

describe('route detail loading', () => {
  it('retains successful route details when another route fails', async () => {
    const loadRoute = vi.fn((id: string) => id === 'one' ? Promise.resolve(route) : Promise.reject(new Error('route unavailable')))
    await expect(loadRouteDetails(['one', 'two'], loadRoute)).resolves.toEqual([
      { id: 'one', route },
      { id: 'two', error: 'route unavailable' },
    ])
  })
})
