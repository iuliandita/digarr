import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import type { ArtistInsert } from '@/db/queries/artists'
import {
  getArtistGenreCacheByMbids,
  upsertArtist,
  upsertArtistGenreAlias,
  upsertArtistGenres,
} from '@/db/queries/artists'

type ArtistRow = {
  id: number
  mbid: string
  name: string
  disambiguation: string | null
  tags: string[] | null
  genres: string[] | null
  imageUrl: string | null
  streamingUrls: Record<string, string> | null
  cachedAt: Date | null
}

function makeArtistRow(data: ArtistInsert, id = 1): ArtistRow {
  return {
    id,
    mbid: data.mbid,
    name: data.name,
    disambiguation: data.disambiguation ?? null,
    tags: data.tags ?? null,
    genres: data.genres ?? null,
    imageUrl: data.imageUrl ?? null,
    streamingUrls: data.streamingUrls ?? null,
    cachedAt: new Date(),
  }
}

describe('upsertArtist', () => {
  it('does not refresh genre freshness for an update without genres', async () => {
    const artist: ArtistInsert = { mbid: 'mbid-image', name: 'Image Only', imageUrl: '/image.jpg' }
    const row = makeArtistRow(artist)
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([row]),
    }
    const db = { insert: vi.fn().mockReturnValue(chain) } as unknown as Database

    await upsertArtist(db, artist)

    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ genresCachedAt: undefined }),
    )
    const conflict = chain.onConflictDoUpdate.mock.calls[0]?.[0]
    expect(conflict.set.genresCachedAt).not.toBeInstanceOf(Date)
  })
})

describe('artist genre cache queries', () => {
  it('rejects malformed MBIDs before constructing a UUID query', async () => {
    const db = { select: vi.fn() } as unknown as Database

    await expect(getArtistGenreCacheByMbids(db, ['not-a-uuid'])).resolves.toEqual([])
    expect(db.select).not.toHaveBeenCalled()
  })

  it('upserts only genre cache fields and refreshes cachedAt', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }
    const db = { insert: vi.fn().mockReturnValue(chain) } as unknown as Database
    const data = {
      mbid: '00000000-0000-0000-0000-000000000022',
      name: 'Warm',
      genres: ['post-rock'],
    }

    await upsertArtistGenres(db, data)

    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ ...data, cachedAt: expect.any(Date) }),
    )
    expect(chain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ genres: ['post-rock'], genresCachedAt: expect.any(Date) }),
      }),
    )
  })

  it('upserts a verified source/name alias to its resolved MBID', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }
    const db = { insert: vi.fn().mockReturnValue(chain) } as unknown as Database
    const data = {
      source: 'subsonic',
      nameNormalized: 'resolved artist',
      mbid: '00000000-0000-0000-0000-000000000033',
    }

    await upsertArtistGenreAlias(db, data)

    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ ...data, resolvedAt: expect.any(Date) }),
    )
    expect(chain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ mbid: data.mbid }) }),
    )
  })
})
