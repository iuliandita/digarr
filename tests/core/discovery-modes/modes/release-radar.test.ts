import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

const getUserConnections = vi.fn()
const resolveSpotifyToken = vi.fn()
const getReleaseGroups = vi.fn()
const lastfmGetTopArtists = vi.fn()
const listenbrainzGetTopArtists = vi.fn()
const spotifyGetTopArtists = vi.fn()

vi.mock('@/db', () => ({
  db: {},
}))

vi.mock('@/db/queries/users', () => ({
  getUserConnections,
}))

vi.mock('@/core/spotify-auth', () => ({
  resolveSpotifyToken,
}))

vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: vi.fn(() => ({
    getReleaseGroups,
  })),
}))

vi.mock('@/core/plugins/lastfm', () => ({
  createLastFmSource: vi.fn(() => ({
    getTopArtists: lastfmGetTopArtists,
  })),
}))

vi.mock('@/core/plugins/listenbrainz', () => ({
  createListenBrainzSource: vi.fn(() => ({
    getTopArtists: listenbrainzGetTopArtists,
  })),
}))

vi.mock('@/core/plugins/spotify', () => ({
  createSpotifySource: vi.fn(() => ({
    getTopArtists: spotifyGetTopArtists,
  })),
}))

describe('createReleaseRadarMode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('emits recent release candidates from fallback listening sources', async () => {
    getUserConnections.mockResolvedValue({
      lastfmUsername: 'lfm-user',
      lastfmApiKey: 'lfm-key',
      listenbrainzUsername: null,
      listenbrainzToken: null,
    })
    resolveSpotifyToken.mockResolvedValue(null)
    lastfmGetTopArtists.mockResolvedValue([
      { name: 'Broadcast', mbid: 'artist-1', playCount: 120, source: 'lastfm' },
      { name: 'Stereolab', mbid: 'artist-2', playCount: 80, source: 'lastfm' },
    ])
    getReleaseGroups.mockImplementation(async (artistMbid: string) => {
      if (artistMbid === 'artist-1') {
        return [
          { id: 'rg-1', title: 'Spell Blanket', type: 'Album', firstReleaseDate: '2026-04-02' },
          {
            id: 'rg-old',
            title: 'Work and Non Work',
            type: 'Album',
            firstReleaseDate: '1997-01-01',
          },
        ]
      }

      return [
        {
          id: 'rg-2',
          title: 'Pulse of the Early Brain',
          type: 'Album',
          firstReleaseDate: '2026-03-20',
        },
      ]
    })

    const { createReleaseRadarMode } = await import('@/core/discovery-modes/modes/release-radar')
    const mode = createReleaseRadarMode()
    const request: DiscoveryModeRequest = {
      modeId: 'release-radar',
      triggerType: 'manual',
      settingsMode: 'advanced',
      userId: 7,
      rawUserSettings: { windowDays: 30 },
      normalizedSettings: { windowDays: 30 },
      providerContext: { providerPath: ['lastfm'] },
      fallbackPolicy: 'allow-fallback',
    }

    const result = await mode.executor(request)

    expect(lastfmGetTopArtists).toHaveBeenCalled()
    expect(result.candidates).toEqual([
      expect.objectContaining({
        candidateType: 'release',
        name: 'Spell Blanket',
        artistName: 'Broadcast',
        artistMbid: 'artist-1',
        releaseGroupMbid: 'rg-1',
        provenanceProvider: 'lastfm',
        fallbackUsed: true,
        freshnessDate: '2026-04-02',
      }),
      expect.objectContaining({
        candidateType: 'release',
        name: 'Pulse of the Early Brain',
        artistName: 'Stereolab',
        artistMbid: 'artist-2',
        releaseGroupMbid: 'rg-2',
        provenanceProvider: 'lastfm',
        fallbackUsed: true,
        freshnessDate: '2026-03-20',
      }),
    ])
  })
})
