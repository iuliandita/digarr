// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveReleasePolicy } from '@/core/slskd/release-policy'

describe('resolveReleasePolicy()', () => {
  it('defaults to album release types with default source', () => {
    expect(resolveReleasePolicy({})).toEqual({
      releaseTypes: ['album'],
      source: 'default',
    })
  })

  it('prefers explicit target release types over Lidarr defaults', () => {
    expect(
      resolveReleasePolicy({
        releaseTypes: ['album', 'ep'],
        lidarrReleaseTypes: ['single'],
      }),
    ).toEqual({
      releaseTypes: ['album', 'ep'],
      source: 'target',
    })
  })
})
