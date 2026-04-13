// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startLibraryHealthScheduler } from '@/core/library/health-scheduler'

function makeMockHealth() {
  return {
    startScan: vi.fn(),
  }
}

describe('startLibraryHealthScheduler', () => {
  let cron: ReturnType<typeof startLibraryHealthScheduler> | undefined

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    cron?.stop()
    cron = undefined
    vi.restoreAllMocks()
  })

  it('constructs cleanly for the default 6h interval', () => {
    const health = makeMockHealth()
    expect(() => {
      cron = startLibraryHealthScheduler({
        intervalHours: 6,
        libraryHealth: health,
      })
    }).not.toThrow()
  })
})
