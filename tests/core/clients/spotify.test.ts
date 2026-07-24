// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpotifyClient } from '@/core/clients/spotify'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('createSpotifyClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches artist albums and sorts full album metadata by popularity', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/artists/sp-artist/albums') {
        return jsonResponse({
          items: [
            { id: 'album-low', name: 'Low', release_date: '1994-01-01', album_type: 'album' },
            { id: 'album-high', name: 'High', release_date: '1997-01-01', album_type: 'album' },
            { id: 'album-mid', name: 'Mid', release_date: '2008-01-01', album_type: 'album' },
          ],
          next: null,
        })
      }
      if (url.pathname === '/albums') {
        expect(url.searchParams.get('ids')).toBe('album-low,album-high,album-mid')
        return jsonResponse({
          albums: [
            { id: 'album-low', name: 'Low', release_date: '1994-01-01', popularity: 40 },
            { id: 'album-high', name: 'High', release_date: '1997-01-01', popularity: 90 },
            { id: 'album-mid', name: 'Mid', release_date: '2008-01-01', popularity: 70 },
          ],
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const client = createSpotifyClient('token', { baseUrl: 'https://spotify.test' })
    const albums = await client.getPopularAlbumsForArtist('sp-artist', 3)

    expect(albums.map((album) => album.id)).toEqual(['album-high', 'album-mid', 'album-low'])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://spotify.test/artists/sp-artist/albums?include_groups=album&limit=10&offset=0',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    )
  })

  it('paginates saved albums, dedupes artist names case-insensitively, and respects the limit', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/me/albums') {
        const offset = url.searchParams.get('offset')
        if (offset === '0') {
          return jsonResponse({
            items: [
              { album: { artists: [{ name: 'Aphex Twin' }] } },
              { album: { artists: [{ name: 'Boards of Canada' }, { name: 'aphex twin' }] } },
            ],
            next: 'https://spotify.test/me/albums?offset=50&limit=50',
          })
        }
        if (offset === '50') {
          return jsonResponse({
            items: [
              { album: { artists: [{ name: 'Boards of Canada' }] } },
              { album: { artists: [{ name: 'Autechre' }] } },
            ],
            next: null,
          })
        }
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const client = createSpotifyClient('token', { baseUrl: 'https://spotify.test' })
    const artists = await client.getSavedAlbums(100)

    expect(artists.map((a) => a.name)).toEqual(['Aphex Twin', 'Boards of Canada', 'Autechre'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops paging once the limit of unique artist names is reached', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/me/albums') {
        return jsonResponse({
          items: [
            { album: { artists: [{ name: 'A' }] } },
            { album: { artists: [{ name: 'B' }] } },
            { album: { artists: [{ name: 'C' }] } },
          ],
          next: 'https://spotify.test/me/albums?offset=50&limit=50',
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const client = createSpotifyClient('token', { baseUrl: 'https://spotify.test' })
    const artists = await client.getSavedAlbums(2)

    expect(artists.map((a) => a.name)).toEqual(['A', 'B'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('getFollowedArtists cursor-paginates and merges followed artists in order', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/me/following') {
        const after = url.searchParams.get('after')
        if (!after) {
          return jsonResponse({
            artists: {
              items: [
                { name: 'Alpha', id: 'a1', genres: ['rock'], popularity: 80 },
                { name: 'Beta', id: 'b1', genres: ['jazz'], popularity: 60 },
              ],
              cursors: { after: 'cur1' },
              next: 'https://spotify.test/me/following?type=artist&limit=50&after=cur1',
            },
          })
        }
        if (after === 'cur1') {
          return jsonResponse({
            artists: {
              items: [{ name: 'Gamma', id: 'g1', genres: [], popularity: 40 }],
              cursors: { after: null },
              next: null,
            },
          })
        }
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const client = createSpotifyClient('token', { baseUrl: 'https://spotify.test' })
    const artists = await client.getFollowedArtists()

    expect(artists).toEqual([
      { name: 'Alpha', id: 'a1', genres: ['rock'], popularity: 80 },
      { name: 'Beta', id: 'b1', genres: ['jazz'], popularity: 60 },
      { name: 'Gamma', id: 'g1', genres: [], popularity: 40 },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('getFollowedArtists respects the limit cap', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/me/following') {
        return jsonResponse({
          artists: {
            items: [
              { name: 'Alpha', id: 'a1', genres: ['rock'], popularity: 80 },
              { name: 'Beta', id: 'b1', genres: ['jazz'], popularity: 60 },
            ],
            cursors: { after: 'cur1' },
            next: 'https://spotify.test/me/following?type=artist&limit=50&after=cur1',
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const client = createSpotifyClient('token', { baseUrl: 'https://spotify.test' })
    const artists = await client.getFollowedArtists(1)

    expect(artists.map((a) => a.name)).toEqual(['Alpha'])
  })

  it('finds the single exact Spotify artist match by name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        artists: {
          items: [
            { id: 'wrong', name: 'Portishead Experience', genres: [], popularity: 10 },
            { id: 'right', name: 'Portishead', genres: ['trip-hop'], popularity: 70 },
          ],
        },
      }),
    )

    const client = createSpotifyClient('token', { baseUrl: 'https://spotify.test' })
    await expect(client.findExactArtistByName('Portishead')).resolves.toMatchObject({
      id: 'right',
      name: 'Portishead',
    })
  })
})
