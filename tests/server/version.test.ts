import { describe, expect, it } from 'vitest'
import { CHANNEL, GIT_SHA, VERSION } from '@/version'

describe('version module', () => {
  it('exposes a non-empty VERSION from package.json', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('falls back to dev/local when build env is unset', () => {
    expect(GIT_SHA).toBe('dev')
    expect(CHANNEL).toBe('local')
  })
})
