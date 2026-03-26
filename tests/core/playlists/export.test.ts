// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  type ExportablePlaylistTrack,
  exportPlaylistToCsv,
  exportPlaylistToJson,
  exportPlaylistToM3u,
  exportPlaylistToXspf,
  getPlaylistTrackLocation,
} from '@/core/playlists/export'

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
})
