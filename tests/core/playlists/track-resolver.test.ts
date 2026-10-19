// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { generatePlaylist } from '@/core/playlists/generator'
import type { StrategyDeps } from '@/core/playlists/strategies/types'
import {
  resolvePlaylistTracksDetailed,
  resolveTracksForArtistDetailed,
} from '@/core/playlists/track-resolver'
import type {
  DeezerTrackSearchResult,
  LocalTrack,
  MBRecording,
  SpotifySearchResult,
  TrackResolverConfig,
  TrackResolverDeps,
} from '@/core/playlists/types'

async function resolveTracksForArtist(...args: Parameters<typeof resolveTracksForArtistDetailed>) {
  return (await resolveTracksForArtistDetailed(...args)).tracks
}

async function resolvePlaylistTracks(...args: Parameters<typeof resolvePlaylistTracksDetailed>) {
  return (await resolvePlaylistTracksDetailed(...args)).flatMap((result) => result.tracks)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LOCAL_TRACKS: LocalTrack[] = [
  { name: 'Creep', artist: 'Radiohead', path: '/music/radiohead/creep.flac' },
  { name: 'Karma Police', artist: 'Radiohead', path: '/music/radiohead/karma-police.flac' },
  { name: 'Paranoid Android', artist: 'Radiohead', path: '/music/radiohead/paranoid-android.flac' },
  { name: 'Fake Plastic Trees', artist: 'Radiohead', path: '/music/radiohead/fake-plastic.flac' },
]

const SPOTIFY_RESULTS: SpotifySearchResult[] = [
  { name: 'Karma Police', artists: ['Radiohead'], uri: 'spotify:track:1', popularity: 85 },
  { name: 'Creep', artists: ['Radiohead'], uri: 'spotify:track:2', popularity: 92 },
  { name: 'Paranoid Android', artists: ['Radiohead'], uri: 'spotify:track:3', popularity: 78 },
  { name: 'Exit Music', artists: ['Radiohead'], uri: 'spotify:track:4', popularity: 70 },
]

const DEEZER_RESULTS: DeezerTrackSearchResult[] = [
  { id: 'dz-1', name: 'Creep', artists: ['Radiohead'], rank: 980000 },
  { id: 'dz-2', name: 'Karma Police', artists: ['Radiohead'], rank: 920000 },
  { id: 'dz-3', name: 'Paranoid Android', artists: ['Radiohead'], rank: 870000 },
  { id: 'dz-4', name: 'Exit Music', artists: ['Radiohead'], rank: 810000 },
]

const MB_RECORDINGS: MBRecording[] = [
  { id: 'mb-rec-1', title: 'Creep' },
  { id: 'mb-rec-2', title: 'Karma Police' },
  { id: 'mb-rec-3', title: 'Paranoid Android' },
]

const DEFAULT_CONFIG: TrackResolverConfig = {
  tracksPerArtist: 3,
  sourcePriority: ['local', 'spotify'],
}

const ARTIST_MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'

// ---------------------------------------------------------------------------
// resolveTracksForArtist
// ---------------------------------------------------------------------------

describe('resolveTracksForArtist()', () => {
  it('filters wrong-artist matches before ranking and limiting for each search source', async () => {
    const artist = 'Beyoncé Knowles'
    const wrongArtist = 'Beyonce Knowles'
    const matchedArtist = '  BEYONCE\u0301   KNOWLES '
    const config: TrackResolverConfig = { tracksPerArtist: 1, sourcePriority: ['local'] }
    const cases: {
      deps: TrackResolverDeps
      source: TrackResolverConfig['sourcePriority'][number]
      expected: object
    }[] = [
      {
        source: 'local',
        deps: {
          jellyfinSearch: vi.fn().mockResolvedValue([
            { name: 'Wrong', artist: wrongArtist, path: '/wrong' },
            { name: 'Right', artist: matchedArtist, path: '/right' },
          ]),
        },
        expected: { localPath: '/right' },
      },
      {
        source: 'spotify',
        deps: {
          spotifySearch: vi.fn().mockResolvedValue([
            { name: 'Wrong', artists: [wrongArtist], uri: 'spotify:wrong', popularity: 99 },
            { name: 'Right', artists: [matchedArtist], uri: 'spotify:right', popularity: 1 },
          ]),
        },
        expected: { spotifyUri: 'spotify:right' },
      },
      {
        source: 'deezer',
        deps: {
          deezerSearch: vi.fn().mockResolvedValue([
            { name: 'Wrong', artists: [wrongArtist], id: 'wrong', rank: 99 },
            { name: 'Right', artists: [matchedArtist], id: 'right', rank: 1 },
          ]),
        },
        expected: { deezerId: 'right' },
      },
    ]
    for (const testCase of cases) {
      const tracks = await resolveTracksForArtist(artist, undefined, testCase.deps, {
        ...config,
        sourcePriority: [testCase.source],
      })
      expect(tracks).toEqual([
        expect.objectContaining({ trackName: 'Right', ...testCase.expected }),
      ])
    }
  })

  it('continues to MusicBrainz when all search results belong to another artist', async () => {
    const result = await resolveTracksForArtistDetailed(
      'Portishead',
      'portishead-mbid',
      {
        jellyfinSearch: vi.fn().mockResolvedValue(LOCAL_TRACKS),
        spotifySearch: vi.fn().mockResolvedValue(SPOTIFY_RESULTS),
        deezerSearch: vi.fn().mockResolvedValue(DEEZER_RESULTS),
        musicbrainzRecordings: vi.fn().mockResolvedValue(MB_RECORDINGS),
      },
      { tracksPerArtist: 1, sourcePriority: ['local', 'spotify', 'deezer'] },
    )
    expect(result.tracks).toEqual([
      expect.objectContaining({ mbid: 'mb-rec-1', source: 'musicbrainz' }),
    ])
    expect(result.outcome).toMatchObject({
      artistName: 'Portishead',
      artistMbid: 'portishead-mbid',
      status: 'resolved',
    })
  })

  it('distinguishes unavailable, unmatched and failed lookups without logging upstream secrets', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const unavailable = await resolveTracksForArtistDetailed(
        'Radiohead',
        undefined,
        {
          musicbrainzRecordings: vi.fn(),
        },
        DEFAULT_CONFIG,
      )
      const unmatched = await resolveTracksForArtistDetailed(
        'Radiohead',
        undefined,
        {
          spotifySearch: vi.fn().mockResolvedValue([]),
        },
        DEFAULT_CONFIG,
      )
      const failed = await resolveTracksForArtistDetailed(
        'Radiohead',
        undefined,
        {
          jellyfinSearch: vi.fn().mockRejectedValue(new Error('token=private-secret')),
          spotifySearch: vi.fn().mockResolvedValue([]),
        },
        DEFAULT_CONFIG,
      )
      expect([unavailable.outcome.status, unmatched.outcome.status, failed.outcome.status]).toEqual(
        ['unavailable', 'unmatched', 'error'],
      )
      expect(warn).toHaveBeenCalledWith('[track-resolver] local lookup failed')
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-secret')
    } finally {
      warn.mockRestore()
    }
  })

  describe('local source', () => {
    it.each(['empty', 'error', 'wrong artist', 'missing path', 'missing title'])(
      'tries the next local connection after %s before catalog fallback',
      async (failure) => {
        const first = vi.fn()
        if (failure === 'error') first.mockRejectedValue(new Error('token=private-secret'))
        else
          first.mockResolvedValue(
            failure === 'empty'
              ? []
              : [
                  {
                    name: failure === 'missing title' ? ' ' : 'Creep',
                    artist: failure === 'wrong artist' ? 'Another artist' : 'Radiohead',
                    path: failure === 'missing path' ? ' ' : '/music/creep.flac',
                  },
                ],
          )
        const embySearch = vi.fn().mockResolvedValue(LOCAL_TRACKS)
        const navidromeSearch = vi.fn()
        const spotifySearch = vi.fn()
        const result = await resolveTracksForArtistDetailed(
          'Radiohead',
          undefined,
          {
            jellyfinSearch: first,
            embySearch,
            navidromeSearch,
            spotifySearch,
          },
          DEFAULT_CONFIG,
        )
        expect(result.tracks).toHaveLength(3)
        expect(result.outcome.status).toBe('resolved')
        expect(embySearch).toHaveBeenCalledWith('Radiohead')
        expect(navidromeSearch).not.toHaveBeenCalled()
        expect(spotifySearch).not.toHaveBeenCalled()
      },
    )

    it('tries every local connection in order before catalog fallback and keeps failed outcomes distinct', async () => {
      const order: string[] = []
      const search = (label: string) =>
        vi.fn(async () => {
          order.push(label)
          return []
        })
      const deps: TrackResolverDeps = {
        jellyfinSearch: search('jellyfin'),
        embySearch: search('emby'),
        navidromeSearch: search('subsonic'),
        plexSearch: search('plex'),
        spotifySearch: search('spotify'),
      }
      const result = await resolveTracksForArtistDetailed(
        'Radiohead',
        undefined,
        deps,
        DEFAULT_CONFIG,
      )
      expect(order).toEqual(['jellyfin', 'emby', 'subsonic', 'plex', 'spotify'])
      expect(result.outcome.status).toBe('unmatched')
      const failed = await resolveTracksForArtistDetailed(
        'Radiohead',
        undefined,
        {
          ...deps,
          embySearch: vi.fn().mockRejectedValue(new Error('unreachable')),
        },
        DEFAULT_CONFIG,
      )
      expect(failed.outcome.status).toBe('error')
    })

    it('returns local tracks when jellyfinSearch is available', async () => {
      const deps: TrackResolverDeps = {
        jellyfinSearch: vi.fn().mockResolvedValue(LOCAL_TRACKS),
      }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG)

      expect(tracks).toHaveLength(3)
      expect(tracks[0]).toMatchObject({
        artistName: 'Radiohead',
        trackName: 'Creep',
        localPath: '/music/radiohead/creep.flac',
        source: 'local',
      })
    })

    it('returns local tracks when navidromeSearch is available', async () => {
      const deps: TrackResolverDeps = {
        navidromeSearch: vi.fn().mockResolvedValue(LOCAL_TRACKS),
      }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG)

      expect(tracks).toHaveLength(3)
      expect(tracks.every((t) => t.source === 'local')).toBe(true)
    })

    it('returns local tracks when plexSearch is available', async () => {
      const deps: TrackResolverDeps = {
        plexSearch: vi.fn().mockResolvedValue(LOCAL_TRACKS),
      }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG)

      expect(tracks).toHaveLength(3)
      expect(tracks.every((t) => t.source === 'local')).toBe(true)
    })

    it('prefers jellyfin over navidrome when both are configured', async () => {
      const jellyfinSearch = vi.fn().mockResolvedValue(LOCAL_TRACKS)
      const navidromeSearch = vi.fn().mockResolvedValue(LOCAL_TRACKS)
      const deps: TrackResolverDeps = { jellyfinSearch, navidromeSearch }

      await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG)

      expect(jellyfinSearch).toHaveBeenCalledOnce()
      expect(navidromeSearch).not.toHaveBeenCalled()
    })
  })

  describe('spotify fallback', () => {
    it('falls back to Spotify when no local search dep is provided', async () => {
      const deps: TrackResolverDeps = {
        spotifySearch: vi.fn().mockResolvedValue(SPOTIFY_RESULTS),
      }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG)

      expect(tracks).toHaveLength(3)
      expect(tracks.every((t) => t.source === 'spotify')).toBe(true)
      expect(tracks[0]).toMatchObject({
        artistName: 'Radiohead',
        spotifyUri: 'spotify:track:2', // highest popularity (92) first
        source: 'spotify',
      })
    })

    it('falls back to Spotify when local search returns empty', async () => {
      const deps: TrackResolverDeps = {
        jellyfinSearch: vi.fn().mockResolvedValue([]),
        spotifySearch: vi.fn().mockResolvedValue(SPOTIFY_RESULTS),
      }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG)

      expect(tracks.every((t) => t.source === 'spotify')).toBe(true)
    })

    it('sorts Spotify results by popularity descending', async () => {
      const deps: TrackResolverDeps = {
        spotifySearch: vi.fn().mockResolvedValue(SPOTIFY_RESULTS),
      }
      const config: TrackResolverConfig = { tracksPerArtist: 4, sourcePriority: ['spotify'] }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, config)

      const popularities = tracks.map((t) => {
        const match = SPOTIFY_RESULTS.find((r) => r.uri === t.spotifyUri)
        return match?.popularity ?? 0
      })
      expect(popularities).toEqual([...popularities].sort((a, b) => b - a))
    })

    it('passes artist: prefix query to spotifySearch', async () => {
      const spotifySearch = vi.fn().mockResolvedValue(SPOTIFY_RESULTS)
      const deps: TrackResolverDeps = { spotifySearch }
      await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, {
        ...DEFAULT_CONFIG,
        sourcePriority: ['spotify'],
      })

      expect(spotifySearch).toHaveBeenCalledWith('artist:Radiohead', 3)
    })
  })

  describe('deezer fallback', () => {
    it('falls back to Deezer when Spotify is not configured', async () => {
      const deps: TrackResolverDeps = {
        deezerSearch: vi.fn().mockResolvedValue(DEEZER_RESULTS),
      }
      const config: TrackResolverConfig = { tracksPerArtist: 3, sourcePriority: ['deezer'] }

      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, config)

      expect(tracks).toHaveLength(3)
      expect(tracks.every((t) => t.source === 'deezer')).toBe(true)
      expect(tracks[0]).toMatchObject({
        artistName: 'Radiohead',
        trackName: 'Creep',
        deezerId: 'dz-1',
        source: 'deezer',
      })
    })

    it('resolves the one exact-name artist and takes its top tracks', async () => {
      const deezerArtists = vi.fn().mockResolvedValue([
        { id: 7, name: 'radiohead' },
        { id: 8, name: 'Radiohead Tribute' },
      ])
      const deezerArtistTopTracks = vi.fn().mockResolvedValue(DEEZER_RESULTS)
      const deezerSearch = vi.fn()

      const result = await resolveTracksForArtistDetailed(
        'Radiohead',
        ARTIST_MBID,
        { deezerArtists, deezerArtistTopTracks, deezerSearch },
        { tracksPerArtist: 2, sourcePriority: ['deezer'] },
      )

      expect(deezerArtistTopTracks).toHaveBeenCalledWith(7, 2)
      expect(deezerSearch).not.toHaveBeenCalled()
      expect(result.tracks.map((t) => [t.deezerId, t.source])).toEqual([
        ['dz-1', 'deezer'],
        ['dz-2', 'deezer'],
      ])
      expect(result.outcome.titleOnly).toBeUndefined()
    })

    it('falls back to a plain exact-artist track search when the artist name is ambiguous', async () => {
      const deezerArtists = vi.fn().mockResolvedValue([
        { id: 7, name: 'Radiohead' },
        { id: 9, name: 'Radiohead' },
      ])
      const deezerArtistTopTracks = vi.fn()
      const deezerSearch = vi
        .fn()
        .mockResolvedValue([
          { id: 'cover', name: 'Creep', artists: ['Radiohead Tribute'], rank: 999999 },
          ...DEEZER_RESULTS.slice(0, 2),
        ])

      const tracks = await resolveTracksForArtist(
        'Radiohead',
        ARTIST_MBID,
        { deezerArtists, deezerArtistTopTracks, deezerSearch },
        { tracksPerArtist: 3, sourcePriority: ['deezer'] },
      )

      expect(deezerArtistTopTracks).not.toHaveBeenCalled()
      expect(deezerSearch).toHaveBeenCalledWith('Radiohead', 25)
      expect(tracks.map((t) => t.deezerId)).toEqual(['dz-1', 'dz-2'])
    })

    it('sorts Deezer results by rank descending', async () => {
      const [first, second, third, fourth] = DEEZER_RESULTS
      if (!first || !second || !third || !fourth) throw new Error('Missing Deezer fixtures')
      const deps: TrackResolverDeps = {
        deezerSearch: vi.fn().mockResolvedValue([third, first, fourth, second]),
      }
      const config: TrackResolverConfig = { tracksPerArtist: 4, sourcePriority: ['deezer'] }

      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, config)

      expect(tracks.map((track) => track.deezerId)).toEqual(['dz-1', 'dz-2', 'dz-3', 'dz-4'])
    })
  })

  describe('MusicBrainz fallback', () => {
    it('falls back to MusicBrainz when no spotify or local results', async () => {
      const deps: TrackResolverDeps = {
        musicbrainzRecordings: vi.fn().mockResolvedValue(MB_RECORDINGS),
      }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG)

      expect(tracks).toHaveLength(3)
      expect(tracks.every((t) => t.source === 'musicbrainz')).toBe(true)
      expect(tracks[0]).toMatchObject({
        artistName: 'Radiohead',
        trackName: 'Creep',
        mbid: 'mb-rec-1',
        source: 'musicbrainz',
      })
    })

    it('flags a MusicBrainz-only resolution as title-only', async () => {
      const result = await resolveTracksForArtistDetailed(
        'Radiohead',
        ARTIST_MBID,
        { musicbrainzRecordings: vi.fn().mockResolvedValue(MB_RECORDINGS) },
        DEFAULT_CONFIG,
      )
      expect(result.outcome).toMatchObject({ status: 'resolved', titleOnly: true })
    })

    it.each([
      '[untitled]',
      'Peel Session (1997-03-02)',
      'Radio Broadcast Fragment',
      'Rehearsal Take',
      'Creep (demo)',
      'Live at the BBC',
      'Interview',
    ])('skips the non-track title %j when real songs exist', async (title) => {
      const tracks = await resolveTracksForArtist(
        'Radiohead',
        ARTIST_MBID,
        {
          musicbrainzRecordings: vi.fn().mockResolvedValue([
            { id: 'bad', title },
            { id: 'good', title: 'Demolition' },
          ]),
        },
        { tracksPerArtist: 1, sourcePriority: [] },
      )
      expect(tracks.map((t) => t.mbid)).toEqual(['good'])
    })

    it('keeps the first recording when every title looks like a non-track', async () => {
      const tracks = await resolveTracksForArtist(
        'Radiohead',
        ARTIST_MBID,
        { musicbrainzRecordings: vi.fn().mockResolvedValue([{ id: 'a', title: '[untitled]' }]) },
        { tracksPerArtist: 1, sourcePriority: [] },
      )
      expect(tracks.map((t) => t.mbid)).toEqual(['a'])
    })

    it('does not call musicbrainzRecordings when local resolves', async () => {
      const musicbrainzRecordings = vi.fn()
      const deps: TrackResolverDeps = {
        jellyfinSearch: vi.fn().mockResolvedValue(LOCAL_TRACKS),
        musicbrainzRecordings,
      }
      await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG)

      expect(musicbrainzRecordings).not.toHaveBeenCalled()
    })

    it('skips MusicBrainz when no artistMbid is provided', async () => {
      const musicbrainzRecordings = vi.fn()
      const deps: TrackResolverDeps = { musicbrainzRecordings }
      const tracks = await resolveTracksForArtist('Radiohead', undefined, deps, DEFAULT_CONFIG)

      expect(musicbrainzRecordings).not.toHaveBeenCalled()
      // No sources available - empty result
      expect(tracks).toHaveLength(0)
    })
  })

  describe('empty result when nothing resolves', () => {
    it('returns [] when no sources are configured', async () => {
      const deps: TrackResolverDeps = {}
      const tracks = await resolveTracksForArtist('Unknown Artist', undefined, deps, DEFAULT_CONFIG)

      expect(tracks).toHaveLength(0)
    })

    it('returns [] when all sources return empty', async () => {
      const deps: TrackResolverDeps = {
        jellyfinSearch: vi.fn().mockResolvedValue([]),
        spotifySearch: vi.fn().mockResolvedValue([]),
        musicbrainzRecordings: vi.fn().mockResolvedValue([]),
      }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG)

      expect(tracks).toHaveLength(0)
    })
  })

  describe('tracksPerArtist limit', () => {
    it('respects tracksPerArtist=1', async () => {
      const deps: TrackResolverDeps = {
        jellyfinSearch: vi.fn().mockResolvedValue(LOCAL_TRACKS),
      }
      const config: TrackResolverConfig = { tracksPerArtist: 1, sourcePriority: ['local'] }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, config)

      expect(tracks).toHaveLength(1)
    })

    it('respects tracksPerArtist=5 (more than available)', async () => {
      const deps: TrackResolverDeps = {
        spotifySearch: vi.fn().mockResolvedValue(SPOTIFY_RESULTS), // 4 results
      }
      const config: TrackResolverConfig = { tracksPerArtist: 5, sourcePriority: ['spotify'] }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, config)

      expect(tracks).toHaveLength(4) // capped by available results, not limit
    })
  })

  describe('sourcePriority order', () => {
    it('tries spotify before local when sourcePriority is ["spotify", "local"]', async () => {
      const jellyfinSearch = vi.fn().mockResolvedValue(LOCAL_TRACKS)
      const spotifySearch = vi.fn().mockResolvedValue(SPOTIFY_RESULTS)
      const deps: TrackResolverDeps = { jellyfinSearch, spotifySearch }
      const config: TrackResolverConfig = {
        tracksPerArtist: 3,
        sourcePriority: ['spotify', 'local'],
      }

      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, config)

      expect(tracks.every((t) => t.source === 'spotify')).toBe(true)
      expect(jellyfinSearch).not.toHaveBeenCalled()
    })

    it('skips local entirely when sourcePriority is ["spotify"] only', async () => {
      const jellyfinSearch = vi.fn().mockResolvedValue(LOCAL_TRACKS)
      const spotifySearch = vi.fn().mockResolvedValue(SPOTIFY_RESULTS)
      const deps: TrackResolverDeps = { jellyfinSearch, spotifySearch }
      const config: TrackResolverConfig = { tracksPerArtist: 3, sourcePriority: ['spotify'] }

      await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, config)

      expect(jellyfinSearch).not.toHaveBeenCalled()
      expect(spotifySearch).toHaveBeenCalledOnce()
    })
  })

  describe('error handling', () => {
    it('falls through to next source when local search throws', async () => {
      const deps: TrackResolverDeps = {
        jellyfinSearch: vi.fn().mockRejectedValue(new Error('connection refused')),
        spotifySearch: vi.fn().mockResolvedValue(SPOTIFY_RESULTS),
      }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG)

      expect(tracks.every((t) => t.source === 'spotify')).toBe(true)
    })

    it('falls through to MusicBrainz when Spotify throws', async () => {
      const deps: TrackResolverDeps = {
        spotifySearch: vi.fn().mockRejectedValue(new Error('rate limited')),
        musicbrainzRecordings: vi.fn().mockResolvedValue(MB_RECORDINGS),
      }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, {
        ...DEFAULT_CONFIG,
        sourcePriority: ['spotify'],
      })

      expect(tracks.every((t) => t.source === 'musicbrainz')).toBe(true)
    })

    it('falls through to MusicBrainz when Deezer throws', async () => {
      const deps: TrackResolverDeps = {
        deezerSearch: vi.fn().mockRejectedValue(new Error('rate limited')),
        musicbrainzRecordings: vi.fn().mockResolvedValue(MB_RECORDINGS),
      }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, {
        ...DEFAULT_CONFIG,
        sourcePriority: ['deezer'],
      })

      expect(tracks.every((t) => t.source === 'musicbrainz')).toBe(true)
    })

    it('returns [] when all sources throw', async () => {
      const deps: TrackResolverDeps = {
        jellyfinSearch: vi.fn().mockRejectedValue(new Error('timeout')),
        spotifySearch: vi.fn().mockRejectedValue(new Error('rate limited')),
        deezerSearch: vi.fn().mockRejectedValue(new Error('rate limited')),
        musicbrainzRecordings: vi.fn().mockRejectedValue(new Error('service unavailable')),
      }
      const tracks = await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG)

      expect(tracks).toHaveLength(0)
    })

    it('never throws - always returns an array', async () => {
      const deps: TrackResolverDeps = {
        jellyfinSearch: vi.fn().mockRejectedValue(new Error('kaboom')),
      }
      await expect(
        resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, DEFAULT_CONFIG),
      ).resolves.toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// resolvePlaylistTracks
// ---------------------------------------------------------------------------

describe('resolvePlaylistTracks()', () => {
  it('processes multiple artists and returns all tracks', async () => {
    const spotifySearch = vi
      .fn()
      .mockImplementation(async (query: string) =>
        SPOTIFY_RESULTS.map((track) => ({ ...track, artists: [query.slice('artist:'.length)] })),
      )
    const deps: TrackResolverDeps = { spotifySearch }
    const config: TrackResolverConfig = { tracksPerArtist: 2, sourcePriority: ['spotify'] }

    const artists = [
      { name: 'Radiohead', mbid: ARTIST_MBID },
      { name: 'Portishead', mbid: 'portishead-mbid' },
    ]

    const tracks = await resolvePlaylistTracks(artists, deps, config)

    expect(tracks).toHaveLength(4) // 2 artists * 2 tracks each
    expect(spotifySearch).toHaveBeenCalledTimes(2)
    expect(spotifySearch).toHaveBeenCalledWith('artist:Radiohead', 2)
    expect(spotifySearch).toHaveBeenCalledWith('artist:Portishead', 2)
  })

  it('processes multiple artists with Deezer when selected in sourcePriority', async () => {
    const deezerSearch = vi
      .fn()
      .mockImplementation(async (query: string) =>
        DEEZER_RESULTS.map((track) => ({ ...track, artists: [query] })),
      )
    const deps: TrackResolverDeps = { deezerSearch }
    const config: TrackResolverConfig = { tracksPerArtist: 2, sourcePriority: ['deezer'] }

    const artists = [
      { name: 'Radiohead', mbid: ARTIST_MBID },
      { name: 'Portishead', mbid: 'portishead-mbid' },
    ]

    const tracks = await resolvePlaylistTracks(artists, deps, config)

    expect(tracks).toHaveLength(4)
    expect(deezerSearch).toHaveBeenCalledTimes(2)
    expect(deezerSearch).toHaveBeenCalledWith('Radiohead', 25)
    expect(deezerSearch).toHaveBeenCalledWith('Portishead', 25)
  })

  it('returns tracks in artist order (not interleaved)', async () => {
    const spotifySearch = vi
      .fn()
      .mockImplementation(async (query: string) =>
        SPOTIFY_RESULTS.map((track) => ({ ...track, artists: [query.slice('artist:'.length)] })),
      )
    const deps: TrackResolverDeps = { spotifySearch }
    const config: TrackResolverConfig = { tracksPerArtist: 1, sourcePriority: ['spotify'] }

    const artists = [
      { name: 'Radiohead', mbid: ARTIST_MBID },
      { name: 'Portishead', mbid: 'portishead-mbid' },
      { name: 'Massive Attack', mbid: 'massive-attack-mbid' },
    ]

    const tracks = await resolvePlaylistTracks(artists, deps, config)

    const artistNames = tracks.map((t) => t.artistName)
    expect(artistNames).toEqual(['Radiohead', 'Portishead', 'Massive Attack'])
  })

  it('handles empty artist list', async () => {
    const deps: TrackResolverDeps = {}
    const tracks = await resolvePlaylistTracks([], deps, DEFAULT_CONFIG)
    expect(tracks).toEqual([])
  })

  it('returns [] for artists that fail to resolve (no fallback entries)', async () => {
    const deps: TrackResolverDeps = {}
    const artists = [{ name: 'Radiohead' }, { name: 'Portishead' }]

    const tracks = await resolvePlaylistTracks(artists, deps, DEFAULT_CONFIG)

    expect(tracks).toHaveLength(0)
  })

  it('rate-limits concurrent calls via p-queue (concurrency=2)', async () => {
    const callOrder: number[] = []
    let activeCount = 0
    let maxActive = 0

    const spotifySearch = vi.fn().mockImplementation(async () => {
      activeCount++
      maxActive = Math.max(maxActive, activeCount)
      // setImmediate-backed yield keeps the async boundary p-queue needs
      // to observe concurrent tasks, without burning real wall time.
      await new Promise<void>((resolve) => setImmediate(resolve))
      activeCount--
      return SPOTIFY_RESULTS
    })

    const deps: TrackResolverDeps = { spotifySearch }
    const config: TrackResolverConfig = { tracksPerArtist: 1, sourcePriority: ['spotify'] }

    const artists = Array.from({ length: 6 }, (_, i) => ({
      name: `Artist ${i}`,
      mbid: `mbid-${i}`,
    }))

    await resolvePlaylistTracks(artists, deps, config)

    // p-queue concurrency=2 means at most 2 tasks run simultaneously
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(spotifySearch).toHaveBeenCalledTimes(6)

    void callOrder // silence unused warning
  })
})

describe('recommended recordings', () => {
  const RECORDING = { mbid: 'e8f9b188-f819-4e43-ab0f-4bd26ce9ff56', title: 'Roads' }
  const portisheadTracks = (roads: SpotifySearchResult): SpotifySearchResult[] => [
    { name: 'Glory Box', artists: ['Portishead'], uri: 'spotify:track:glory', popularity: 99 },
    roads,
  ]

  it('Audition plays the stored recording, not the artist top track', async () => {
    const strategyDeps: StrategyDeps = {
      getPendingArtists: vi
        .fn()
        .mockResolvedValue([
          { name: 'Portishead', mbid: 'mbid-ph', score: 0.9, recording: RECORDING },
        ]),
      getApprovedArtists: vi.fn(),
      getOlderApprovedArtists: vi.fn(),
    }
    const spotifySearch = vi.fn().mockResolvedValue(
      portisheadTracks({
        name: 'Roads',
        artists: ['Portishead'],
        uri: 'spotify:track:roads',
        popularity: 80,
      }),
    )

    const result = await generatePlaylist(
      'audition',
      { trackSourcePriority: ['spotify'] },
      strategyDeps,
      { spotifySearch },
    )

    expect(result.tracks).toEqual([
      {
        artistName: 'Portishead',
        trackName: 'Roads',
        mbid: RECORDING.mbid,
        spotifyUri: 'spotify:track:roads',
        source: 'spotify',
      },
    ])
  })

  it.each([
    { name: 'remaster only', match: { name: 'Roads - 2008 Remaster', artists: ['Portishead'] } },
    {
      name: 'same title by another artist',
      match: { name: 'Roads', artists: ['Portishead Tribute'] },
    },
  ])('keeps the MusicBrainz identity instead of swapping songs: $name', async (testCase) => {
    const spotifySearch = vi
      .fn()
      .mockResolvedValue(
        portisheadTracks({ ...testCase.match, uri: 'spotify:track:roads', popularity: 80 }),
      )
    const localSearch = vi.fn().mockResolvedValue(LOCAL_TRACKS)

    const result = await resolveTracksForArtistDetailed(
      'Portishead',
      'mbid-ph',
      { spotifySearch, jellyfinSearch: localSearch },
      { tracksPerArtist: 1, sourcePriority: ['local', 'spotify'] },
      RECORDING,
    )

    expect(result.tracks).toEqual([
      { artistName: 'Portishead', trackName: 'Roads', mbid: RECORDING.mbid, source: 'musicbrainz' },
    ])
  })

  it('resolves the artist the usual way when the stored recording has no title', async () => {
    const spotifySearch = vi.fn().mockResolvedValue(
      portisheadTracks({
        name: 'Roads',
        artists: ['Portishead'],
        uri: 'spotify:track:roads',
        popularity: 80,
      }),
    )

    const result = await resolveTracksForArtistDetailed(
      'Portishead',
      'mbid-ph',
      { spotifySearch },
      { tracksPerArtist: 1, sourcePriority: ['spotify'] },
      { mbid: RECORDING.mbid },
    )

    expect(result.tracks).toEqual([
      expect.objectContaining({ trackName: 'Glory Box', spotifyUri: 'spotify:track:glory' }),
    ])
  })

  it.each([
    {
      source: 'spotify' as const,
      query: 'artist:"David Bowie" track:"Heroes"',
      deps: (search: ReturnType<typeof vi.fn>): TrackResolverDeps => ({
        spotifySearch: search.mockResolvedValue([
          { name: '"Heroes"', artists: ['David Bowie'], uri: 'spotify:track:h', popularity: 1 },
        ]) as unknown as TrackResolverDeps['spotifySearch'],
      }),
    },
    {
      source: 'deezer' as const,
      query: 'David Bowie "Heroes"',
      deps: (search: ReturnType<typeof vi.fn>): TrackResolverDeps => ({
        deezerSearch: search.mockResolvedValue([
          { id: 'h', name: '"Heroes"', artists: ['David Bowie'], rank: 1 },
        ]) as unknown as TrackResolverDeps['deezerSearch'],
      }),
    },
  ])('matches a quoted title on $source without breaking the query', async (testCase) => {
    const search = vi.fn()
    const result = await resolveTracksForArtistDetailed(
      'David Bowie',
      'mbid-db',
      testCase.deps(search),
      { tracksPerArtist: 1, sourcePriority: [testCase.source] },
      { mbid: RECORDING.mbid, title: '"Heroes"' },
    )

    expect(search).toHaveBeenCalledWith(testCase.query, 10)
    expect(result.tracks[0]).toMatchObject({ source: testCase.source, mbid: RECORDING.mbid })
  })
})
