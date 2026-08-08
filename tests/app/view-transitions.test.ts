import { afterEach, describe, expect, it, vi } from 'vitest'
import { canUseViewTransitions } from '../../src/app/components/view-transitions'

describe('atlas navigation transitions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(document, 'startViewTransition')
  })

  it('runs without the View Transition API', () => {
    expect(canUseViewTransitions()).toBe(false)
  })

  it('disables view transitions when reduced motion is requested', () => {
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: vi.fn() })
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true })) })
    expect(canUseViewTransitions()).toBe(false)
  })
})
