import { describe, expect, it } from 'vitest'
import { classifyFailure } from '@/core/jobs/failure-scope'

describe('classifyFailure', () => {
  it.each([
    ['Lidarr returned HTTP 503', 'integration'],
    ['Request failed with status 429', 'integration'],
    ['HTTP 401 Unauthorized', 'integration'],
    ['fetch failed', 'integration'],
    ['connect ECONNREFUSED 127.0.0.1:8686', 'integration'],
    ['Lidarr is not configured in Settings > Connections', 'item'],
    ['Artist already exists in Lidarr', 'item'],
    ['Release type not allowed by the Lidarr metadata profile', 'item'],
    ['Lidarr returned HTTP 400', 'item'],
    ['slskd target requires user context', 'item'],
    ['something odd happened', undefined],
  ])('%s -> %s', (error, scope) => {
    expect(classifyFailure(error)).toBe(scope)
  })
})
