import { describe, expect, it } from 'vitest'
import { compareContentVersions, parseContentVersion } from '../../src/lib/content-version'

describe('runtime version metadata', () => {
  it('parses and compares only valid knowledge versions', () => {
    expect(parseContentVersion('2026.07.30-01')).toEqual({ year: 2026, month: 7, day: 30, sequence: 1 })
    expect(parseContentVersion('2026.02.30-01')).toBeUndefined()
    expect(compareContentVersions('2026.07.30-01', '2026.08.01-01')).toBe('older')
    expect(compareContentVersions('2026.08.01-01', '2026.07.30-01')).toBe('newer')
    expect(compareContentVersions('invalid', '2026.07.30-01')).toBeUndefined()
    expect(compareContentVersions('2026.07.30-01', '2026.07.30-01', 'a'.repeat(64), 'b'.repeat(64))).toBe('fingerprint-mismatch')
  })
})
