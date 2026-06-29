import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reportApprovalOutcome } from '@/web/lib/approval'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

const { toast } = await import('sonner')

// Stub translator returning templates with placeholders so .replace() has work to do.
const t = ((key: string) => {
  if (key === 'discover.approvePartial') return 'Added to {0} of {1}. Failed: {2}'
  if (key === 'discover.approveAllFailed') return 'All failed: {0}'
  return key
}) as never

describe('reportApprovalOutcome', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true and shows nothing when every target succeeds', () => {
    const clean = reportApprovalOutcome(
      {
        status: 'added_to_lidarr',
        targetSummary: { total: 2, succeeded: 2, failed: 0, failures: [] },
      },
      t,
    )
    expect(clean).toBe(true)
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('warns with counts and failed names on partial failure', () => {
    const clean = reportApprovalOutcome(
      {
        status: 'added_to_lidarr',
        targetSummary: {
          total: 3,
          succeeded: 2,
          failed: 1,
          failures: [{ id: 'lidarr-2', name: 'Backup', error: 'down' }],
        },
      },
      t,
    )
    expect(clean).toBe(false)
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('Backup'))
    const msg =
      (toast.warning as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[0] ?? ''
    expect(msg).toContain('2')
    expect(msg).toContain('3')
    expect(msg).toContain('Backup')
  })

  it('errors when no target succeeds', () => {
    const clean = reportApprovalOutcome(
      {
        status: 'add_failed',
        targetSummary: {
          total: 2,
          succeeded: 0,
          failed: 2,
          failures: [
            { id: 'lidarr-1', name: 'A' },
            { id: 'lidarr-2', name: 'B' },
          ],
        },
      },
      t,
    )
    expect(clean).toBe(false)
    expect(toast.error).toHaveBeenCalledOnce()
  })

  it('errors on add_failed even without a summary', () => {
    const clean = reportApprovalOutcome({ status: 'add_failed' }, t)
    expect(clean).toBe(false)
    expect(toast.error).toHaveBeenCalledOnce()
  })

  it('returns true for a plain approve with no targets', () => {
    expect(reportApprovalOutcome({ status: 'approved' }, t)).toBe(true)
  })
})
