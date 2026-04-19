// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 1 }]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
}

vi.mock('@/db/schema', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/schema')>()
  return { ...original }
})

const { createTarget, getTargetsByUser, getTarget, updateTarget, deleteTarget } = await import(
  '@/db/queries/targets'
)

describe('target queries', () => {
  it('createTarget returns the new target id', async () => {
    const result = await createTarget(mockDb as never, {
      type: 'lidarr',
      name: 'My Lidarr',
      config: { url: 'http://localhost:8686', apiKey: 'abc' },
      userId: 1,
    })
    expect(result).toEqual({ id: 1 })
  })

  it('getTarget calls select with eq filter', async () => {
    mockDb.select.mockReturnThis()
    mockDb.from.mockReturnThis()
    mockDb.where.mockResolvedValue([{ id: 1, type: 'lidarr', name: 'Test' }])
    const result = await getTarget(mockDb as never, 1)
    expect(result).toEqual({ id: 1, type: 'lidarr', name: 'Test' })
  })

  it('getTarget returns null when not found', async () => {
    mockDb.where.mockResolvedValue([])
    const result = await getTarget(mockDb as never, 999)
    expect(result).toBeNull()
  })

  it('getTargetsByUser returns rows', async () => {
    mockDb.where.mockReturnThis()
    mockDb.orderBy.mockResolvedValue([{ id: 1, userId: 1, type: 'lidarr' }])
    const result = await getTargetsByUser(mockDb as never, 1)
    expect(result).toHaveLength(1)
  })

  it('updateTarget calls update with set and where', async () => {
    mockDb.set.mockReturnThis()
    mockDb.where.mockResolvedValue(undefined)
    await updateTarget(mockDb as never, 1, { name: 'Updated' })
    expect(mockDb.update).toHaveBeenCalled()
  })

  it('deleteTarget calls delete with where', async () => {
    mockDb.where.mockResolvedValue(undefined)
    await deleteTarget(mockDb as never, 1)
    expect(mockDb.delete).toHaveBeenCalled()
  })
})
