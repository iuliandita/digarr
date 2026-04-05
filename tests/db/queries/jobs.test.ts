// @vitest-environment node
import { describe, expect, it } from 'vitest'

describe('job queries', () => {
  it('exports listJobs function', async () => {
    const mod = await import('@/db/queries/jobs')
    expect(typeof mod.listJobs).toBe('function')
  })

  it('exports getJobById function', async () => {
    const mod = await import('@/db/queries/jobs')
    expect(typeof mod.getJobById).toBe('function')
  })

  it('exports getJobHealth function', async () => {
    const mod = await import('@/db/queries/jobs')
    expect(typeof mod.getJobHealth).toBe('function')
  })

  it('exports getJobsForSubscription function', async () => {
    const mod = await import('@/db/queries/jobs')
    expect(typeof mod.getJobsForSubscription).toBe('function')
  })
})
