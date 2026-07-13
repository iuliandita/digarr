import { describe, expect, it } from 'vitest'
import { backupFileSchema } from '@/server/schemas/admin'

function makeBase() {
  return {
    version: 1,
    appVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    encryptionKeyHash: null,
    includesCaches: false,
    data: {
      settings: [],
      users: [],
      oauthTokens: [],
      oidcTokens: [],
      targets: [],
      subscriptions: [],
      jobRuns: [],
      recommendationBatches: [],
      recommendations: [],
      playlists: [],
      playlistTracks: [],
    },
  }
}

describe('backupFileSchema', () => {
  it('accepts backup containing artistBlocks (regression: was rejected by strictObject)', () => {
    const payload = {
      ...makeBase(),
      data: { ...makeBase().data, artistBlocks: [{ id: 1, userId: 1, artistId: 1 }] },
    }
    const result = backupFileSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('accepts full migration backup with albumBlocks, libraryArtists, slskdJobs', () => {
    const payload = {
      ...makeBase(),
      includesCaches: true,
      data: {
        ...makeBase().data,
        artists: [],
        artistGenreAliases: [],
        genres: [],
        artistMetadata: [],
        artistBlocks: [],
        albumBlocks: [{ id: 1, userId: 1, releaseGroupMbid: 'rg-001' }],
        libraryArtists: [{ id: 1, source: 'lidarr' }],
        libraryAlbums: [],
        librarySyncState: [],
        libraryMatchOverrides: [],
        libraryAlbumMatchOverrides: [],
        libraryHealthState: [],
        recordingArtistCache: [],
        slskdJobs: [{ id: 1, state: 'pending' }],
      },
    }
    const result = backupFileSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('accepts legacy subscriptionRuns key in place of jobRuns', () => {
    const payload = {
      ...makeBase(),
      data: {
        ...makeBase().data,
        subscriptionRuns: [{ id: 1, type: 'subscription', status: 'completed' }],
      },
    }
    const result = backupFileSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })
})
