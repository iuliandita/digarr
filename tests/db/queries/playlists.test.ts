// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import type { PlaylistInsert, PlaylistTrackInsert } from '@/db/queries/playlists'
import {
  createPlaylist,
  deletePlaylist,
  getPlaylistsByUser,
  getPlaylistsDueForGeneration,
  getPlaylistWithTracks,
  replacePlaylistTracks,
  updatePlaylist,
} from '@/db/queries/playlists'

function makePlaylistRow(data: PlaylistInsert, id = 1) {
  return {
    id,
    userId: data.userId ?? null,
    name: data.name,
    strategy: data.strategy,
    targetIds: data.targetIds ?? [],
    schedule: data.schedule ?? null,
    config: data.config ?? null,
    lastGeneratedAt: null,
    trackCount: 0,
    enabled: data.enabled ?? true,
    createdAt: new Date(),
  }
}

const baseInsert: PlaylistInsert = {
  name: 'Weekly Digest',
  strategy: 'weekly_digest',
  userId: 1,
}

describe('createPlaylist', () => {
  it('returns the new playlist id', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 5 }]),
    }
    const db = { insert: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await createPlaylist(db, baseInsert)

    expect(result).toEqual({ id: 5 })
    expect(chain.values).toHaveBeenCalledOnce()
  })

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

describe('getPlaylistsByUser', () => {
  it('returns playlists for the given user', async () => {
    const rows = [
      makePlaylistRow(baseInsert, 1),
      makePlaylistRow({ ...baseInsert, name: 'Mix' }, 2),
    ]
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getPlaylistsByUser(db, 1)

    expect(result).toHaveLength(2)
    expect(chain.where).toHaveBeenCalledOnce()
  })

  it('returns empty array when user has no playlists', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getPlaylistsByUser(db, 99)
    expect(result).toHaveLength(0)
  })
})

describe('getPlaylistWithTracks', () => {
  it('returns playlist and tracks when found', async () => {
    const playlistRow = makePlaylistRow(baseInsert, 3)
    const trackRows = [
      {
        id: 1,
        playlistId: 3,
        artistName: 'Radiohead',
        trackName: 'Creep',
        mbid: null,
        spotifyUri: null,
        deezerId: null,
        localPath: null,
        position: 0,
      },
    ]

    const playlistChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([playlistRow]),
    }
    const trackChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(trackRows),
    }
    const db = {
      select: vi.fn().mockReturnValueOnce(playlistChain).mockReturnValueOnce(trackChain),
    } as unknown as Database

    const result = await getPlaylistWithTracks(db, 3)

    expect(result).not.toBeNull()
    expect(result?.playlist.id).toBe(3)
    expect(result?.tracks).toHaveLength(1)
    expect(result?.tracks[0]?.artistName).toBe('Radiohead')
    expect(trackChain.orderBy).toHaveBeenCalledOnce()
  })

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

describe('updatePlaylist', () => {
  it('calls update with set and where', async () => {
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }
    const db = { update: vi.fn().mockReturnValue(chain) } as unknown as Database

    await updatePlaylist(db, 1, { name: 'Renamed', enabled: false })

    expect(chain.set).toHaveBeenCalledOnce()
    expect(chain.where).toHaveBeenCalledOnce()
    // biome-ignore lint/style/noNonNullAssertion: mock call args
    const setArg = chain.set.mock.calls[0]![0]
    expect(setArg.name).toBe('Renamed')
    expect(setArg.enabled).toBe(false)
  })
})

describe('deletePlaylist', () => {
  it('calls delete with where', async () => {
    const chain = {
      where: vi.fn().mockResolvedValue(undefined),
    }
    const db = { delete: vi.fn().mockReturnValue(chain) } as unknown as Database

    await deletePlaylist(db, 7)

    expect(chain.where).toHaveBeenCalledOnce()
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

describe('getPlaylistsDueForGeneration', () => {
  it('returns enabled playlists with no lastGeneratedAt or stale one', async () => {
    const rows = [
      makePlaylistRow(baseInsert, 1),
      makePlaylistRow({ ...baseInsert, name: 'Old' }, 2),
    ]
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(rows),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getPlaylistsDueForGeneration(db)

    expect(result).toHaveLength(2)
    expect(chain.where).toHaveBeenCalledOnce()
  })

  it('returns empty array when no playlists are due', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getPlaylistsDueForGeneration(db)
    expect(result).toHaveLength(0)
  })
})
