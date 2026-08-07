import { describe, expect, it } from 'vitest'
import { shellSummary, updateSummary } from '../../src/app/pages/OfflinePages'

describe('offline primary status copy', () => {
  it('keeps a healthy active version concise and treats cooldown as non-error', () => {
    expect(shellSummary({ status: 'offline-ready', lifecycle: 'controlling', appVersion: '0.3.1' })).toBe('可离线使用')
    expect(updateSummary({ status: 'up-to-date', checked_at: '2026-08-07T00:00:00.000Z', message: 'Active knowledge is up to date.' })).toBe('已是最新')
    expect(updateSummary({ status: 'cooldown', checked_at: '2026-08-07T00:00:00.000Z', message: '近期已检查过知识更新。' })).toBe('近期已检查')
  })
})
