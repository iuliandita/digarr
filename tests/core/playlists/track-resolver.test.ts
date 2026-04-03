// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { resolvePlaylistTracks, resolveTracksForArtist } from '@/core/playlists/track-resolver'
import type {
  DeezerTrackSearchResult,
  LocalTrack,
  MBRecording,
  SpotifySearchResult,
  TrackResolverConfig,
  TrackResolverDeps,
} from '@/core/playlists/types'

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
  describe('local source', () => {
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

    it('passes Deezer artist query syntax to deezerSearch', async () => {
      const deezerSearch = vi.fn().mockResolvedValue(DEEZER_RESULTS)
      const deps: TrackResolverDeps = { deezerSearch }

      await resolveTracksForArtist('Radiohead', ARTIST_MBID, deps, {
        ...DEFAULT_CONFIG,
        sourcePriority: ['deezer'],
      })

      expect(deezerSearch).toHaveBeenCalledWith('artist:"Radiohead"', 3)
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
      // No sources available -- empty result
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

    it('never throws -- always returns an array', async () => {
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
    const spotifySearch = vi.fn().mockResolvedValue(SPOTIFY_RESULTS)
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
    const deezerSearch = vi.fn().mockResolvedValue(DEEZER_RESULTS)
    const deps: TrackResolverDeps = { deezerSearch }
    const config: TrackResolverConfig = { tracksPerArtist: 2, sourcePriority: ['deezer'] }

    const artists = [
      { name: 'Radiohead', mbid: ARTIST_MBID },
      { name: 'Portishead', mbid: 'portishead-mbid' },
    ]

    const tracks = await resolvePlaylistTracks(artists, deps, config)

    expect(tracks).toHaveLength(4)
    expect(deezerSearch).toHaveBeenCalledTimes(2)
    expect(deezerSearch).toHaveBeenCalledWith('artist:"Radiohead"', 2)
    expect(deezerSearch).toHaveBeenCalledWith('artist:"Portishead"', 2)
  })

  it('returns tracks in artist order (not interleaved)', async () => {
    const spotifySearch = vi.fn().mockResolvedValue(SPOTIFY_RESULTS)
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
      await new Promise((resolve) => setTimeout(resolve, 10))
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
