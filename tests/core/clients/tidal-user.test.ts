// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTidalUserClient } from '@/core/clients/tidal-user'

const BASE = 'https://tidal.test/v2'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function artistPage(
  entries: Array<{ id: string; name?: string }>,
  next?: string,
): Record<string, unknown> {
  return {
    data: entries.map((e) => ({ id: e.id, type: 'artists' })),
    included: entries
      .filter((e) => e.name !== undefined)
      .map((e) => ({ id: e.id, type: 'artists', attributes: { name: e.name } })),
    links: next ? { next } : {},
  }
}

describe('createTidalUserClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves artist names from the included resources and sends the collection.read shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/v2/userCollectionArtists/me/relationships/items')
      expect(url.searchParams.get('include')).toBe('items')
      expect(url.searchParams.get('sort')).toBe('-addedAt')
      return jsonResponse(
        artistPage([
          { id: '1', name: 'Portishead' },
          { id: '2', name: 'Massive Attack' },
        ]),
      )
    })

    const client = createTidalUserClient('token', { baseUrl: BASE })
    const artists = await client.getFavoriteArtists(10)

    expect(artists.map((a) => a.name)).toEqual(['Portishead', 'Massive Attack'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('follows the page cursor until the limit is reached', async () => {
    const seenCursors: Array<string | null> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input))
      const cursor = url.searchParams.get('page[cursor]')
      seenCursors.push(cursor)
      if (!cursor) {
        return jsonResponse(
          artistPage(
            [
              { id: '1', name: 'A' },
              { id: '2', name: 'B' },
            ],
            `${BASE}/userCollectionArtists/me/relationships/items?page%5Bcursor%5D=next-page`,
          ),
        )
      }
      return jsonResponse(artistPage([{ id: '3', name: 'C' }]))
    })

    const client = createTidalUserClient('token', { baseUrl: BASE })
    const artists = await client.getFavoriteArtists(3)

    expect(seenCursors).toEqual([null, 'next-page'])
    expect(artists.map((a) => a.name)).toEqual(['A', 'B', 'C'])
  })

  it('stops at the limit without requesting another page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(
        artistPage(
          [
            { id: '1', name: 'A' },
            { id: '2', name: 'B' },
          ],
          `${BASE}/userCollectionArtists/me/relationships/items?page%5Bcursor%5D=next-page`,
        ),
      ),
    )

    const client = createTidalUserClient('token', { baseUrl: BASE })
    const artists = await client.getFavoriteArtists(1)

    expect(artists).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('skips identifiers with no matching included artist and dedupes repeats', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(artistPage([{ id: '1', name: 'A' }, { id: '2' }, { id: '1', name: 'A' }])),
    )

    const client = createTidalUserClient('token', { baseUrl: BASE })
    const artists = await client.getFavoriteArtists(10)

    expect(artists.map((a) => a.id)).toEqual(['1'])
  })

  it('resolves a relative next link against the configured base URL', async () => {
    const seenHosts: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input))
      seenHosts.push(url.host)
      const cursor = url.searchParams.get('page[cursor]')
      if (!cursor) {
        return jsonResponse(
          artistPage([{ id: '1', name: 'A' }], '/v2/relationships/items?page%5Bcursor%5D=page-2'),
        )
      }
      return jsonResponse(artistPage([{ id: '2', name: 'B' }]))
    })

    const client = createTidalUserClient('token', { baseUrl: BASE })
    const artists = await client.getFavoriteArtists(10)

    expect(artists.map((a) => a.name)).toEqual(['A', 'B'])
    expect(new Set(seenHosts)).toEqual(new Set(['tidal.test']))
  })

  it('stops instead of looping forever when the cursor never advances', async () => {
    const selfReferential = `${BASE}/userCollectionArtists/me/relationships/items?page%5Bcursor%5D=stuck`
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        jsonResponse(artistPage([{ id: '1', name: 'A' }], selfReferential)),
      )

    const client = createTidalUserClient('token', { baseUrl: BASE })
    const artists = await client.getFavoriteArtists(50)

    expect(artists.map((a) => a.id)).toEqual(['1'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws when the collection has items but no sideloaded artists', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({
        data: [{ id: '1', type: 'artists' }],
        included: [{ id: '1', type: 'artist', attributes: { name: 'A' } }],
        links: {},
      }),
    )

    const client = createTidalUserClient('token', { baseUrl: BASE })

    await expect(client.getFavoriteArtists(10)).rejects.toThrow(
      /include=items response shape has changed/,
    )
  })
})
