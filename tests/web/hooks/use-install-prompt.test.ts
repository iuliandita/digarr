import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('useInstallPrompt utilities', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('detects iOS via user agent', async () => {
    const { isIos } = await import('@/web/hooks/use-install-prompt')
    expect(isIos()).toBe(false)
  })

  it('detects standalone mode', async () => {
    const { isStandalone } = await import('@/web/hooks/use-install-prompt')
    expect(isStandalone()).toBe(false)
  })
})
