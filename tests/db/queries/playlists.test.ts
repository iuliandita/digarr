// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import type { PlaylistInsert, PlaylistTrackInsert } from '@/db/queries/playlists'
import {
  createPlaylist,
  getPlaylistWithTracks,
  replacePlaylistTracks,
} from '@/db/queries/playlists'

const baseInsert: PlaylistInsert = {
  name: 'Weekly Digest',
  strategy: 'weekly_digest',
  userId: 1,
}

describe('createPlaylist', () => {
  it('throws when no row returned', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    }
    const db = { insert: vi.fn().mockReturnValue(chain) } as unknown as Database

    await expect(createPlaylist(db, baseInsert)).rejects.toThrow('createPlaylist: no row returned')
  })

  it('defaults targetIds to empty array', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 1 }]),
    }
    const db = { insert: vi.fn().mockReturnValue(chain) } as unknown as Database

    await createPlaylist(db, { name: 'Test', strategy: 'genre_focus' })

    // biome-ignore lint/style/noNonNullAssertion: mock call args
    const valArg = chain.values.mock.calls[0]![0]
    expect(valArg.targetIds).toEqual([])
  })
})

describe('getPlaylistWithTracks', () => {
  it('returns null when playlist not found', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getPlaylistWithTracks(db, 999)
    expect(result).toBeNull()
  })
})

describe('replacePlaylistTracks', () => {
  it('deletes existing tracks then inserts new ones', async () => {
    const deleteChain = {
      where: vi.fn().mockResolvedValue(undefined),
    }
    const insertChain = {
      values: vi.fn().mockResolvedValue(undefined),
    }
    const txMock = {
      delete: vi.fn().mockReturnValue(deleteChain),
      insert: vi.fn().mockReturnValue(insertChain),
    }
    const db = {
      transaction: vi
        .fn()
        .mockImplementation((fn: (tx: typeof txMock) => Promise<void>) => fn(txMock)),
    } as unknown as Database

    const tracks: PlaylistTrackInsert[] = [
      { playlistId: 1, artistName: 'Portishead', position: 0 },
      { playlistId: 1, artistName: 'Massive Attack', position: 1 },
    ]
    await replacePlaylistTracks(db, 1, tracks)

    expect(txMock.delete).toHaveBeenCalledOnce()
    expect(deleteChain.where).toHaveBeenCalledOnce()
    expect(txMock.insert).toHaveBeenCalledOnce()
    expect(insertChain.values).toHaveBeenCalledOnce()
    // biome-ignore lint/style/noNonNullAssertion: mock call args
    const insertedRows = insertChain.values.mock.calls[0]![0] as unknown[]
    expect(insertedRows).toHaveLength(2)
  })

  it('skips insert when tracks array is empty', async () => {
    const deleteChain = {
      where: vi.fn().mockResolvedValue(undefined),
    }
    const txMock = {
      delete: vi.fn().mockReturnValue(deleteChain),
      insert: vi.fn(),
    }
    const db = {
      transaction: vi
        .fn()
        .mockImplementation((fn: (tx: typeof txMock) => Promise<void>) => fn(txMock)),
    } as unknown as Database

    await replacePlaylistTracks(db, 1, [])

    expect(txMock.delete).toHaveBeenCalledOnce()
    expect(txMock.insert).not.toHaveBeenCalled()
  })
})
