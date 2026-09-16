// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  type ExportablePlaylistTrack,
  exportPlaylistToCsv,
  exportPlaylistToJson,
  exportPlaylistToM3u,
  exportPlaylistToXspf,
  getPlaylistTrackLocation,
  pushPlaylistToTargets,
} from '@/core/playlists/export'
import type { DestinationTarget, PlaylistItem } from '@/core/targets/types'

const SAMPLE: ExportablePlaylistTrack[] = [
  {
    artistName: 'Radiohead',
    trackName: 'Creep',
    mbid: 'mbid-creep',
    spotifyUri: 'spotify:track:abc123',
    deezerId: null,
    localPath: null,
    position: 0,
  },
  {
    artistName: 'Massive Attack',
    trackName: 'Teardrop',
    mbid: 'mbid-teardrop',
    spotifyUri: null,
    deezerId: '456',
    localPath: null,
    position: 1,
  },
  {
    artistName: 'Biosphere',
    trackName: null,
    mbid: null,
    spotifyUri: null,
    deezerId: null,
    localPath: '/music/Biosphere/Substrata/01 - As the Sun Kissed the Horizon.flac',
    position: 2,
  },
]

describe('playlist export helpers', () => {
  it('prefers local paths, then Spotify, Deezer, and MusicBrainz locations', () => {
    const [spotifyTrack, deezerTrack, localTrack] = SAMPLE
    expect(spotifyTrack).toBeDefined()
    expect(deezerTrack).toBeDefined()
    expect(localTrack).toBeDefined()
    expect(getPlaylistTrackLocation(spotifyTrack as ExportablePlaylistTrack)).toBe(
      'https://open.spotify.com/track/abc123',
    )
    expect(getPlaylistTrackLocation(deezerTrack as ExportablePlaylistTrack)).toBe(
      'https://www.deezer.com/track/456',
    )
    expect(getPlaylistTrackLocation(localTrack as ExportablePlaylistTrack)).toBe(
      '/music/Biosphere/Substrata/01 - As the Sun Kissed the Horizon.flac',
    )
  })

  it('exports JSON with resolved locations', () => {
    const result = exportPlaylistToJson(SAMPLE)
    expect(result).toContain('"artistName": "Radiohead"')
    expect(result).toContain('"location": "https://open.spotify.com/track/abc123"')
  })

  it('exports CSV with track locations', () => {
    const result = exportPlaylistToCsv(SAMPLE)
    expect(result).toContain('position,artist,track,location')
    expect(result).toContain('Massive Attack,Teardrop,https://www.deezer.com/track/456')
  })

  it('exports M3U entries with artist and track names', () => {
    const result = exportPlaylistToM3u(SAMPLE)
    expect(result).toContain('#EXTM3U')
    expect(result).toContain('#EXTINF:-1,Radiohead - Creep')
    expect(result).toContain('#EXTINF:-1,Biosphere - Biosphere')
  })

  it('exports XSPF with playlist metadata and recording identifiers', () => {
    const result = exportPlaylistToXspf(SAMPLE, { title: 'Night Mix' })
    expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(result).toContain('<title>Night Mix</title>')
    expect(result).toContain('<creator>Massive Attack</creator>')
    expect(result).toContain(
      '<identifier>https://musicbrainz.org/recording/mbid-teardrop</identifier>',
    )
  })

  it('attempts every target and raises failures after the remaining exports finish', async () => {
    const attempted: string[] = []
    const target = (
      id: number,
      type: DestinationTarget['type'],
      createPlaylist: NonNullable<DestinationTarget['createPlaylist']>,
    ): DestinationTarget => ({
      id: `${type}-${id}`,
      name: type,
      type,
      capabilities: ['createPlaylist'],
      createPlaylist,
      testConnection: vi.fn(),
    })
    const items: PlaylistItem[] = [{ artistName: 'Radiohead', artistMbid: 'mbid-rh' }]

    await expect(
      pushPlaylistToTargets(
        [
          target(1, 'plex-playlist', async () => {
            attempted.push('plex')
            return { success: false, targetType: 'plex-playlist', targetId: 1, error: 'forbidden' }
          }),
          target(2, 'jellyfin-playlist', async () => {
            attempted.push('jellyfin')
            return { success: true, targetType: 'jellyfin-playlist', targetId: 2 }
          }),
          target(3, 'navidrome-playlist', async () => {
            attempted.push('navidrome')
            throw new Error('unreachable')
          }),
        ],
        'Picks',
        items,
      ),
    ).rejects.toThrow(
      'Playlist export failed: plex-playlist(1): forbidden; navidrome-playlist-3: unreachable',
    )

    expect(attempted).toEqual(['plex', 'jellyfin', 'navidrome'])
  })
})
