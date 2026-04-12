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
        targetConfig: { releaseTypes: ['album', 'ep'] },
        lidarrDefaults: { metadataProfileId: 1 },
      }),
    ).toEqual({
      releaseTypes: ['album', 'ep'],
      source: 'target',
    })
  })

  it('falls through when target release types are empty', () => {
    expect(
      resolveReleasePolicy({
        targetConfig: { releaseTypes: [] },
        lidarrDefaults: { metadataProfileId: 42 },
      }),
    ).toEqual({
      releaseTypes: ['album'],
      source: 'lidarr',
    })
  })

  it('uses Lidarr defaults when target config is absent', () => {
    expect(resolveReleasePolicy({ lidarrDefaults: { metadataProfileId: 42 } })).toEqual({
      releaseTypes: ['album'],
      source: 'lidarr',
    })
  })
})
