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

const { lookupByName, bulkUpsert } = await import('@/db/queries/artist-metadata')

describe('artist-metadata queries', () => {
  it('lookupByName returns null when not found', async () => {
    mockDb.limit.mockResolvedValue([])
    const result = await lookupByName(mockDb as never, 'nonexistent')
    expect(result).toBeNull()
  })

  it('bulkUpsert returns 0 for empty input', async () => {
    const count = await bulkUpsert(mockDb as never, [])
    expect(count).toBe(0)
  })
})
