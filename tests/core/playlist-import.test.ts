// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PlaylistFormatError, parsePlaylistFile, playlistFormatFor } from '@/core/playlist-import'

describe('parsePlaylistFile', () => {
  it.each([
    {
      name: 'M3U EXTINF artist, split on first " - "',
      format: 'm3u' as const,
      text: '#EXTM3U\n#EXTINF:215,Radiohead - Paranoid Android - Live\n/music/x.mp3\n',
      artists: ['Radiohead'],
      unreadable: 0,
    },
    {
      name: 'M3U path fallback for Artist/Album/NN - Title',
      format: 'm3u' as const,
      text: '#EXTM3U\n/music/Portishead/Dummy/01 - Mysterons.flac\n',
      artists: ['Portishead'],
      unreadable: 0,
    },
    {
      name: 'M3U path fallback for flat Artist - Title',
      format: 'm3u' as const,
      text: 'Bjork - Hyperballad.mp3\n',
      artists: ['Bjork'],
      unreadable: 0,
    },
    {
      name: 'M3U ambiguous or unstructured entries count as unreadable',
      format: 'm3u' as const,
      text: '01 - Track.mp3\nTitle Only.mp3\nA - B - C.mp3\nhttps://example.com/stream\n',
      artists: [],
      unreadable: 4,
    },
    {
      name: 'M3U dedupes artists case-insensitively',
      format: 'm3u' as const,
      text: '#EXTINF:1,Radiohead - One\na.mp3\n#EXTINF:1,RADIOHEAD - Two\nb.mp3\n',
      artists: ['Radiohead'],
      unreadable: 0,
    },
    {
      name: 'XSPF attributes, tag whitespace, case sensitivity and first creator',
      format: 'xspf' as const,
      text:
        '<playlist version="1" ><trackList>' +
        '<track id="1" ><CREATOR>Ignored</CREATOR><creator role="artist" >Bj&#246;rk</creator \n>' +
        '<creator>Second creator</creator></track \t>' +
        '<track><Creator>Ignored</Creator></track>' +
        '<TRACK><creator>Ignored</creator></TRACK>' +
        '</trackList></playlist >',
      artists: ['Björk'],
      unreadable: 1,
    },
    {
      name: 'XSPF creator elements with entities and CDATA',
      format: 'xspf' as const,
      text:
        '<?xml version="1.0"?><playlist version="1"><trackList>' +
        '<track><creator>AC&amp;DC</creator><title>Thunderstruck</title></track>' +
        '<track><creator><![CDATA[Sigur R&oacute;s]]></creator></track>' +
        '<track><title>No creator</title></track>' +
        '</trackList></playlist>',
      artists: ['AC&DC', 'Sigur R&oacute;s'],
      unreadable: 1,
    },
  ])('$name', ({ format, text, artists, unreadable }) => {
    expect(parsePlaylistFile(text, format, 500)).toEqual({ artists, unreadable })
  })

  it('caps artists at maxArtists and dedupes before capping', () => {
    const text = `#EXTM3U\n${['A', 'A', 'B', 'C'].map((a) => `#EXTINF:1,${a} - t\nx.mp3`).join('\n')}`
    expect(parsePlaylistFile(text, 'm3u', 2).artists).toEqual(['A', 'B'])
  })

  it.each([
    {
      name: 'unterminated track openers after closers',
      text: `<playlist></playlist>${'</track>'.repeat(69_866)}${'<track '.repeat(69_866)}`,
      unreadable: 0,
    },
    {
      name: 'unterminated creator openers',
      text: `<playlist><track>${'<creator '.repeat(116_000)}</track></playlist>`,
      unreadable: 1,
    },
  ])('parses near-1 MiB XSPF with $name in under a second', ({ text, unreadable }) => {
    const start = performance.now()
    const result = parsePlaylistFile(text, 'xspf', 500)
    const elapsed = performance.now() - start
    expect(result).toEqual({ artists: [], unreadable })
    expect(elapsed).toBeLessThan(1000)
  })

  it.each([
    ['truncated XSPF', '<playlist><trackList><track><creator>X</creator></trackList></playlist>'],
    ['missing playlist root', '<trackList><track><creator>X</creator></track></trackList>'],
    [
      'DOCTYPE with external entity',
      '<?xml version="1.0"?><!DOCTYPE playlist [<!ENTITY x SYSTEM "file:///etc/passwd">]>' +
        '<playlist><trackList><track><creator>&x;</creator></track></trackList></playlist>',
    ],
  ])('rejects %s', (_, text) => {
    expect(() => parsePlaylistFile(text, 'xspf', 500)).toThrow(PlaylistFormatError)
  })

  it.each([
    ['song.m3u', 'm3u'],
    ['SONG.M3U8', 'm3u'],
    ['list.xspf', 'xspf'],
    ['artists.csv', 'csv'],
    ['notes.txt', 'csv'],
  ])('detects format for %s', (filename, format) => {
    expect(playlistFormatFor(filename)).toBe(format)
  })
})
