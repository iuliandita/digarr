// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { recordFailureSafely } from '@/core/jobs/record-failure-safely'
import type { JobRecorder } from '@/core/jobs/types'

function fakeRecorder(fail: JobRecorder['fail']): JobRecorder {
  return {
    start: vi.fn(),
    complete: vi.fn(),
    fail,
    markStuck: vi.fn(),
  } as unknown as JobRecorder
}

describe('recordFailureSafely', () => {
  it('forwards jobId and message to recorder.fail', async () => {
    const fail = vi.fn().mockResolvedValue(undefined)
    await recordFailureSafely(fakeRecorder(fail), 7, 'boom')
    expect(fail).toHaveBeenCalledWith(7, 'boom')
  })

  it('swallows a rejecting recorder.fail so the caller can rethrow the real error', async () => {
    const fail = vi.fn().mockRejectedValue(new Error('db down'))
    await expect(recordFailureSafely(fakeRecorder(fail), 7, 'boom')).resolves.toBeUndefined()
  })
})
