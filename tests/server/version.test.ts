import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('version module env injection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('reads GIT_SHA and CHANNEL from build env when set', async () => {
    vi.stubEnv('DIGARR_GIT_SHA', 'abc1234')
    vi.stubEnv('DIGARR_CHANNEL', 'nightly')
    vi.resetModules()
    const mod = await import('@/version')
    expect(mod.GIT_SHA).toBe('abc1234')
    expect(mod.CHANNEL).toBe('nightly')
  })
})
