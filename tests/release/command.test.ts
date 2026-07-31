import { describe, expect, it } from 'vitest'
import { npmCommand } from '../../scripts/release/command'

describe('release command selection', () => {
  it('uses npm.cmd on Windows without changing command arguments', () => {
    expect(npmCommand('win32')).toBe('npm.cmd')
    expect(npmCommand('linux')).toBe('npm')
  })
})
