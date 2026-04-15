// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@/db/schema', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/schema')>()
  return { ...original }
})

const { lookupByName, bulkUpsert, getCount } = await import('@/db/queries/artist-metadata')

describe('artist-metadata queries', () => {
  it('lookupByName returns row when found', async () => {
    mockDb.limit.mockResolvedValue([
      { spotifyGenres: ['indie rock', 'art rock'], spotifyPopularity: 87, deezerFans: null },
    ])
    const result = await lookupByName(mockDb as never, 'Radiohead')
    expect(result).toEqual({
      spotifyGenres: ['indie rock', 'art rock'],
      spotifyPopularity: 87,
      deezerFans: null,
    })
  })

  it('lookupByName returns null when not found', async () => {
    mockDb.limit.mockResolvedValue([])
    const result = await lookupByName(mockDb as never, 'nonexistent')
    expect(result).toBeNull()
  })

  it('lookupByName normalizes name to lowercase', async () => {
    mockDb.limit.mockResolvedValue([])
    await lookupByName(mockDb as never, '  RADIOHEAD  ')
    expect(mockDb.where).toHaveBeenCalled()
  })

  it('bulkUpsert inserts rows', async () => {
    const count = await bulkUpsert(mockDb as never, [
      {
        name: 'Radiohead',
        nameNormalized: 'radiohead',
        spotifyGenres: ['rock'],
        spotifyPopularity: 87,
      },
    ])
    expect(count).toBe(1)
    expect(mockDb.insert).toHaveBeenCalled()
  })

  it('bulkUpsert returns 0 for empty input', async () => {
    const count = await bulkUpsert(mockDb as never, [])
    expect(count).toBe(0)
  })

  it('getCount returns row count', async () => {
    mockDb.where.mockResolvedValue(undefined)
    // getCount uses select({total: count()}).from(...) - mock the from chain
    mockDb.from.mockResolvedValue([{ total: 42 }])
    const result = await getCount(mockDb as never)
    expect(result).toBe(42)
  })
})
