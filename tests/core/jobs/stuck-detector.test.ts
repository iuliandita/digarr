// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { startStuckDetector } from '@/core/jobs/stuck-detector'

describe('startStuckDetector', () => {
  it('returns a Cron instance', () => {
    const mockRecorder = {
      start: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      markStuck: vi.fn().mockResolvedValue(0),
    }
    const cron = startStuckDetector(mockRecorder)
    expect(cron).toBeDefined()
    cron.stop()
  })
})
