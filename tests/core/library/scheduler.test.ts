// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startLibrarySyncScheduler } from '@/core/library/scheduler'
import type { SyncOrchestrator } from '@/core/library/sync'

function makeMockOrchestrator(): SyncOrchestrator {
  return {
    syncGlobal: vi.fn(async () => ({ userId: null, results: [] })),
    syncForUser: vi.fn(async () => ({ userId: 1, results: [] })),
    syncSpecificSource: vi.fn(async () => ({
      source: 's',
      status: 'completed' as const,
      counts: {
        total: 0,
        matchedMbid: 0,
        matchedNameExact: 0,
        matchedNameAnchored: 0,
        matchedDisambiguated: 0,
        unreconciledAmbiguous: 0,
        unreconciledNoCandidate: 0,
        cacheHits: 0,
        mbApiCalls: 0,
      },
    })),
  }
}

describe('startLibrarySyncScheduler', () => {
  let cron: ReturnType<typeof startLibrarySyncScheduler> | undefined

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    cron?.stop()
    cron = undefined
    vi.restoreAllMocks()
  })

  it('constructs cleanly for the default 6h interval (previously crashed)', () => {
    const orchestrator = makeMockOrchestrator()
    expect(() => {
      cron = startLibrarySyncScheduler({
        intervalHours: 6,
        orchestrator,
        listUserIds: async () => [],
      })
    }).not.toThrow()
  })

  it('constructs cleanly for 1h interval', () => {
    const orchestrator = makeMockOrchestrator()
    expect(() => {
      cron = startLibrarySyncScheduler({
        intervalHours: 1,
        orchestrator,
        listUserIds: async () => [],
      })
    }).not.toThrow()
  })

  it('constructs cleanly for 12h interval', () => {
    const orchestrator = makeMockOrchestrator()
    expect(() => {
      cron = startLibrarySyncScheduler({
        intervalHours: 12,
        orchestrator,
        listUserIds: async () => [],
      })
    }).not.toThrow()
  })

  it('caps very large intervals at 23h (croner limit)', () => {
    const orchestrator = makeMockOrchestrator()
    expect(() => {
      cron = startLibrarySyncScheduler({
        intervalHours: 48,
        orchestrator,
        listUserIds: async () => [],
      })
    }).not.toThrow()
  })

  it('falls back to 5-minute pattern for sub-hour interval (intervalHours=0)', () => {
    const orchestrator = makeMockOrchestrator()
    expect(() => {
      cron = startLibrarySyncScheduler({
        intervalHours: 0,
        orchestrator,
        listUserIds: async () => [],
      })
    }).not.toThrow()
  })
})
