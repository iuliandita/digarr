// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { createEmbyLibrarySource } from '@/core/library/sources/emby'

describe('createEmbyLibrarySource', () => {
  it('maps Emby artists into LibraryArtist rows', async () => {
    const source = createEmbyLibrarySource(
      {
        getAllArtists: vi.fn().mockResolvedValue([
          {
            id: 'emby-artist-1',
            name: 'Biosphere',
            mbid: '11111111-1111-1111-1111-111111111111',
            genres: ['ambient'],
          },
        ]),
        getAlbumsForArtist: vi.fn(),
        testConnection: vi.fn(),
      } as never,
      7,
    )

    await expect(source.listArtists()).resolves.toEqual([
      {
        sourceArtistId: 'emby-artist-1',
        name: 'Biosphere',
        mbid: '11111111-1111-1111-1111-111111111111',
        genres: ['ambient'],
      },
    ])
  })
})
