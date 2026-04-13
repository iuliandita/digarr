// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { createLibrarySyncStore } from '@/core/library/store'
import { libraryAlbums, libraryArtists } from '@/db/schema'

const SQLITE_MAX_HOST_PARAMETERS = 32_766
const ARTIST_INSERT_COLUMNS = 9
const ALBUM_INSERT_COLUMNS = 12

type InsertCall = {
  table: unknown
  rows: unknown[]
}

type MockTx = {
  delete: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
}

function makeDb() {
  const insertCalls: InsertCall[] = []
  const where = vi.fn().mockResolvedValue(undefined)
  const del = vi.fn().mockReturnValue({ where })
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn(async (rows: unknown[]) => {
      insertCalls.push({ table, rows })
      return []
    }),
  }))
  const tx: MockTx = { delete: del, insert }
  const transaction = vi.fn(async (callback: (tx: MockTx) => Promise<unknown>) => callback(tx))

  return {
    transaction,
    _mocks: {
      del,
      insert,
      insertCalls,
      where,
    },
  }
}

function makeArtist(index: number) {
  return {
    sourceArtistId: `artist-${index}`,
    name: `Artist ${index}`,
    nameNormalized: `artist ${index}`,
    mbid: null,
    matchMethod: null,
    matchConfidence: null,
    genres: [],
    unreconciledReason: 'no_candidate' as const,
  }
}

function makeAlbum(index: number) {
  return {
    sourceAlbumId: `album-${index}`,
    sourceArtistId: `artist-${index}`,
    title: `Album ${index}`,
    titleNormalized: `album ${index}`,
    albumMbid: null,
    artistMbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    releaseYear: 2000,
    primaryType: 'Album' as const,
    matchMethod: null,
    matchConfidence: null,
  }
}

describe('LibrarySyncStore chunked inserts', () => {
  it('splits oversized album writes into sqlite-safe chunks', async () => {
    const db = makeDb()
    const store = createLibrarySyncStore(db as never)
    const albums = Array.from({ length: 3_000 }, (_, index) => makeAlbum(index))

    await store.replaceLibraryAlbums(1, 'plex', albums)

    const albumCalls = db._mocks.insertCalls.filter((call) => call.table === libraryAlbums)
    expect(albumCalls.length).toBeGreaterThan(1)
    expect(albumCalls.reduce((total, call) => total + call.rows.length, 0)).toBe(albums.length)
    expect(
      albumCalls.every(
        (call) => call.rows.length * ALBUM_INSERT_COLUMNS <= SQLITE_MAX_HOST_PARAMETERS,
      ),
    ).toBe(true)
  })

  it('chunks artist and album snapshot writes independently inside one transaction', async () => {
    const db = makeDb()
    const store = createLibrarySyncStore(db as never)
    const artists = Array.from({ length: 4_000 }, (_, index) => makeArtist(index))
    const albums = Array.from({ length: 3_000 }, (_, index) => makeAlbum(index))

    await store.replaceLibrarySnapshot(1, 'plex', artists, albums)

    const artistCalls = db._mocks.insertCalls.filter((call) => call.table === libraryArtists)
    const albumCalls = db._mocks.insertCalls.filter((call) => call.table === libraryAlbums)

    expect(db.transaction).toHaveBeenCalledOnce()
    expect(artistCalls.length).toBeGreaterThan(1)
    expect(albumCalls.length).toBeGreaterThan(1)
    expect(artistCalls.reduce((total, call) => total + call.rows.length, 0)).toBe(artists.length)
    expect(albumCalls.reduce((total, call) => total + call.rows.length, 0)).toBe(albums.length)
    expect(
      artistCalls.every(
        (call) => call.rows.length * ARTIST_INSERT_COLUMNS <= SQLITE_MAX_HOST_PARAMETERS,
      ),
    ).toBe(true)
    expect(
      albumCalls.every(
        (call) => call.rows.length * ALBUM_INSERT_COLUMNS <= SQLITE_MAX_HOST_PARAMETERS,
      ),
    ).toBe(true)
  })
})
