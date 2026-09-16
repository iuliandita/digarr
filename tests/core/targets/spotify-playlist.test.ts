// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSpotifyPlaylistTarget } from '@/core/targets/spotify-playlist'

const ACCESS_TOKEN = 'spotify-access-token-secret'
const mockGetAccessToken = vi.fn().mockResolvedValue(ACCESS_TOKEN)
const mockFetch = vi.fn()

vi.stubGlobal('fetch', mockFetch)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function trackUri(value: string): string {
  return `spotify:track:${value.padStart(22, '0')}`
}

function spotifyTrack(uri: string, name: string, artist: string) {
  return { uri, name, artists: [{ name: artist }] }
}

function setupSuccessResponses(tracks: unknown[] = []) {
  mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url)
    if (path.includes('/v1/search')) return json({ tracks: { items: tracks } })
    if (path.endsWith('/v1/me/playlists') && init?.method === 'POST') {
      return json({ id: 'playlist-1', name: 'Generated' })
    }
    if (path.includes('/v1/playlists/playlist-1/items') && init?.method === 'POST') {
      return json({ snapshot_id: 'snapshot-1' })
    }
    if (path.endsWith('/v1/me')) return json({ display_name: 'Test User' })
    return new Response('Not Found', { status: 404 })
  })
}

function target() {
  return createSpotifyPlaylistTarget(3, { getAccessToken: mockGetAccessToken })
}

function playlistMutationCalls() {
  return mockFetch.mock.calls.filter(([url, init]) => {
    const path = String(url)
    return (
      (path.endsWith('/v1/me/playlists') || path.includes('/v1/playlists/')) &&
      (init as RequestInit | undefined)?.method === 'POST'
    )
  })
}

function requestBody(call: [unknown, RequestInit | undefined] | undefined): unknown {
  if (!call) throw new Error('Expected a request')
  return JSON.parse(call[1]?.body as string)
}

afterEach(() => {
  mockFetch.mockReset()
  mockGetAccessToken.mockReset().mockResolvedValue(ACCESS_TOKEN)
})

describe('createSpotifyPlaylistTarget()', () => {
  it('has correct type and capabilities', () => {
    const result = target()
    expect(result.type).toBe('spotify-playlist')
    expect(result.capabilities).toEqual(['createPlaylist'])
  })

  it('uses explicit track URIs in order without searching', async () => {
    setupSuccessResponses()
    const first = trackUri('1')
    const second = trackUri('2')

    const result = await target().createPlaylist?.('Generated', [
      { artistName: 'Radiohead', artistMbid: 'mbid-rh', spotifyUri: first },
      { artistName: 'Biosphere', artistMbid: 'mbid-bio', spotifyUri: second },
    ])

    expect(result).toMatchObject({ success: true, itemsAdded: 2, playlistId: 'playlist-1' })
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/v1/search'))).toBe(false)
    const addCall = mockFetch.mock.calls.find(([url]) => String(url).includes('/items')) as
      | [unknown, RequestInit | undefined]
      | undefined
    expect(requestBody(addCall)).toEqual({
      uris: [first, second],
    })
    expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith('/v1/me'))).toBe(false)
  })

  it('uses only a strict artist and title match from track search results', async () => {
    const unrelated = trackUri('3')
    const exact = trackUri('4')
    setupSuccessResponses([
      spotifyTrack(unrelated, 'Creep', 'Cover Band'),
      spotifyTrack(exact, 'Creep', ' Radiohead '),
    ])

    const result = await target().createPlaylist?.('Generated', [
      { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: ' Creep ' },
    ])

    expect(result).toMatchObject({ success: true, itemsAdded: 1 })
    const addCall = mockFetch.mock.calls.find(([url]) => String(url).includes('/items')) as
      | [unknown, RequestInit | undefined]
      | undefined
    expect(requestBody(addCall)).toEqual({ uris: [exact] })
  })

  it('keeps up to three exact artist matches for artist-only items', async () => {
    const matches = ['5', '6', '7', '8'].map(trackUri)
    setupSuccessResponses([
      spotifyTrack(trackUri('x'), 'Wrong Artist', 'Other Artist'),
      ...matches.map((uri, index) => spotifyTrack(uri, `Track ${index}`, 'Radiohead')),
    ])

    const result = await target().createPlaylist?.('Generated', [
      { artistName: ' Radiohead ', artistMbid: 'mbid-rh' },
    ])

    expect(result).toMatchObject({ success: true, itemsAdded: 3 })
    const addCall = mockFetch.mock.calls.find(([url]) => String(url).includes('/items')) as
      | [unknown, RequestInit | undefined]
      | undefined
    expect(requestBody(addCall)).toEqual({
      uris: matches.slice(0, 3),
    })
  })

  it('creates an empty playlist when no strict track match exists', async () => {
    setupSuccessResponses([spotifyTrack(trackUri('9'), 'Creep (Live)', 'Radiohead')])

    const result = await target().createPlaylist?.('Generated', [
      { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
    ])

    expect(result).toMatchObject({ success: true, itemsAdded: 0 })
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/items'))).toBe(false)
  })

  it('fails before playlist creation when a search returns a malformed track URI', async () => {
    setupSuccessResponses([spotifyTrack('spotify:track:not-valid', 'Creep', 'Radiohead')])

    const result = await target().createPlaylist?.('Generated', [
      { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
    ])

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('Invalid Spotify track URI returned by search')
    expect(playlistMutationCalls()).toHaveLength(0)
  })

  it('rejects malformed supplied Spotify URIs before any remote mutation', async () => {
    const result = await target().createPlaylist?.('Generated', [
      { artistName: 'Radiohead', artistMbid: 'mbid-rh', spotifyUri: 'spotify:track:not-valid' },
    ])

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('Invalid Spotify track URI')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fails before playlist creation on a forbidden search and redacts the access token', async () => {
    mockFetch.mockResolvedValueOnce(new Response(`token=${ACCESS_TOKEN}`, { status: 403 }))

    const result = await target().createPlaylist?.('Generated', [
      { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
    ])

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('Spotify API 403')
    expect(result?.error).not.toContain(ACCESS_TOKEN)
    expect(playlistMutationCalls()).toHaveLength(0)
  })

  it('fails before playlist creation on a search transport error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('search transport failed'))

    const result = await target().createPlaylist?.('Generated', [
      { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
    ])

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('search transport failed')
    expect(playlistMutationCalls()).toHaveLength(0)
  })

  it('returns a failure when playlist creation fails', async () => {
    mockFetch.mockResolvedValueOnce(new Response('creation failed', { status: 500 }))

    const result = await target().createPlaylist?.('Generated', [])

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('Spotify API 500: creation failed')
    expect(playlistMutationCalls()).toHaveLength(1)
  })

  it('returns a failure when adding items fails', async () => {
    const uri = trackUri('a')
    mockFetch
      .mockResolvedValueOnce(json({ id: 'playlist-1', name: 'Generated' }))
      .mockResolvedValueOnce(new Response('add failed', { status: 500 }))

    const result = await target().createPlaylist?.('Generated', [
      { artistName: 'Radiohead', artistMbid: 'mbid-rh', spotifyUri: uri },
    ])

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('Spotify API 500: add failed')
    expect(playlistMutationCalls()).toHaveLength(2)
  })

  it('fails without adding items when playlist creation returns an empty response', async () => {
    mockFetch.mockResolvedValueOnce(json({}))

    const result = await target().createPlaylist?.('Generated', [])

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('Spotify did not return a playlist ID and name')
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/items'))).toBe(false)
  })

  it('fails without adding items when playlist creation returns malformed fields', async () => {
    mockFetch.mockResolvedValueOnce(json({ id: 'playlist-1', name: 42 }))

    const result = await target().createPlaylist?.('Generated', [])

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('Spotify did not return a playlist ID and name')
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/items'))).toBe(false)
  })

  it('batches explicit track URIs into ordered groups of 100', async () => {
    setupSuccessResponses()
    const uris = Array.from({ length: 101 }, (_, index) => trackUri(String(index)))

    const result = await target().createPlaylist?.(
      'Generated',
      uris.map((spotifyUri, index) => ({
        artistName: `Artist ${index}`,
        artistMbid: `mbid-${index}`,
        spotifyUri,
      })),
    )

    expect(result).toMatchObject({ success: true, itemsAdded: 101 })
    const addCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes('/items'))
    expect(addCalls).toHaveLength(2)
    expect(requestBody(addCalls[0] as [unknown, RequestInit | undefined] | undefined)).toEqual({
      uris: uris.slice(0, 100),
    })
    expect(requestBody(addCalls[1] as [unknown, RequestInit | undefined] | undefined)).toEqual({
      uris: uris.slice(100),
    })
  })

  it('uses /v1/me only to test the Spotify connection', async () => {
    setupSuccessResponses()

    const result = await target().testConnection()

    expect(result).toMatchObject({ success: true, message: 'Connected as Test User' })
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe('https://api.spotify.com/v1/me')
  })
})
