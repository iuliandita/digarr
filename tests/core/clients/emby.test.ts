// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmbyClient } from '@/core/clients/emby'

describe('createEmbyClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('maps top artists from the Emby items endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            Items: [
              { Id: 'a1', Name: 'Boards of Canada', UserData: { PlayCount: 12, IsFavorite: true } },
            ],
            TotalRecordCount: 1,
          }),
      }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.getTopArtists(10)).resolves.toEqual([
      { id: 'a1', name: 'Boards of Canada', playCount: 12, isFavorite: true },
    ])
  })

  it('passes through MusicBrainz artist ids for full-library artist sync', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            Items: [
              {
                Id: 'artist-1',
                Name: 'Radiohead',
                Genres: ['alternative'],
                ProviderIds: { MusicBrainzArtist: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' },
              },
            ],
            TotalRecordCount: 1,
          }),
      }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.getAllArtists()).resolves.toEqual([
      {
        id: 'artist-1',
        name: 'Radiohead',
        mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        genres: ['alternative'],
      },
    ])
  })

  it('returns a friendly connection message from /System/Info', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ServerName: 'My Emby', Version: '4.9.0.1' }),
      }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.testConnection()).resolves.toMatchObject({
      success: true,
      message: 'Connected to Emby "My Emby" v4.9.0.1',
    })
  })
})
