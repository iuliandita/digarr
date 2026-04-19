import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import type { SubscriptionInsert } from '@/db/queries/subscriptions'
import {
  createSubscription,
  deleteSubscription,
  getEnabledSubscriptions,
  getSubscription,
  getSubscriptionsByUser,
  updateSubscription,
} from '@/db/queries/subscriptions'

type SubscriptionRow = {
  id: number
  name: string
  userId: number | null
  enabled: boolean
  sourceType: string
  sourceProvider: string
  sourceConfig: Record<string, unknown>
  maxArtistsPerRun: number
  listenerRange: { min?: number; max?: number } | null
  cron: string
  action: string
  scoreThreshold: number | null
  scoringWeightPreset: string | null
  scoringWeightOverrides: Record<string, number> | null
  lastRunAt: Date | null
  lastResultCount: number | null
  lastError: string | null
  createdAt: Date
  updatedAt: Date
}

function makeSubRow(data: SubscriptionInsert, id = 1): SubscriptionRow {
  return {
    id,
    name: data.name,
    userId: data.userId ?? null,
    enabled: data.enabled ?? true,
    sourceType: data.sourceType,
    sourceProvider: data.sourceProvider,
    sourceConfig: data.sourceConfig,
    maxArtistsPerRun: data.maxArtistsPerRun ?? 20,
    listenerRange: data.listenerRange ?? null,
    cron: data.cron,
    action: data.action ?? 'add_to_recommendations',
    scoreThreshold: data.scoreThreshold ?? null,
    scoringWeightPreset: data.scoringWeightPreset ?? 'default',
    scoringWeightOverrides: data.scoringWeightOverrides ?? null,
    lastRunAt: null,
    lastResultCount: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

const baseInsert: SubscriptionInsert = {
  name: 'Test Sub',
  sourceType: 'genre',
  sourceProvider: 'musicbrainz',
  sourceConfig: { genre: 'metal' },
  cron: '0 0 * * 0',
}

describe('createSubscription', () => {
  it('returns the created subscription row', async () => {
    const row = makeSubRow(baseInsert, 42)
    const chain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([row]),
    }
    const db = { insert: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await createSubscription(db, baseInsert)

    expect(result.id).toBe(42)
    expect(result.name).toBe('Test Sub')
    expect(result.sourceType).toBe('genre')
  })

  it('throws when no row returned', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    }
    const db = { insert: vi.fn().mockReturnValue(chain) } as unknown as Database

    await expect(createSubscription(db, baseInsert)).rejects.toThrow(
      'createSubscription: no row returned',
    )
  })
})

describe('getSubscription', () => {
  it('returns the subscription when found', async () => {
    const row = makeSubRow(baseInsert, 5)
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([row]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getSubscription(db, 5)

    expect(result).not.toBeNull()
    expect(result?.id).toBe(5)
  })

  it('returns null when not found', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getSubscription(db, 999)
    expect(result).toBeNull()
  })
})

describe('getSubscriptionsByUser', () => {
  it('returns subscriptions for the given user', async () => {
    const rows = [
      makeSubRow({ ...baseInsert, userId: 3 }, 1),
      makeSubRow({ ...baseInsert, userId: 3, name: 'Sub 2' }, 2),
    ]
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getSubscriptionsByUser(db, 3)

    expect(result).toHaveLength(2)
    expect(chain.where).toHaveBeenCalledOnce()
  })

  it('returns empty array when user has no subscriptions', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getSubscriptionsByUser(db, 99)
    expect(result).toHaveLength(0)
  })
})

describe('getEnabledSubscriptions', () => {
  it('returns only enabled subscriptions', async () => {
    const rows = [makeSubRow(baseInsert, 1), makeSubRow(baseInsert, 2)]
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(rows),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getEnabledSubscriptions(db)

    expect(result).toHaveLength(2)
    expect(chain.where).toHaveBeenCalledOnce()
  })
})

describe('updateSubscription', () => {
  it('calls update with set and where', async () => {
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }
    const db = { update: vi.fn().mockReturnValue(chain) } as unknown as Database

    await updateSubscription(db, 1, { name: 'Updated', enabled: false })

    expect(chain.set).toHaveBeenCalledOnce()
    expect(chain.where).toHaveBeenCalledOnce()
    // updatedAt should be injected
    // biome-ignore lint/style/noNonNullAssertion: mock call args
    const setArg = chain.set.mock.calls[0]![0]
    expect(setArg).toHaveProperty('updatedAt')
    expect(setArg.name).toBe('Updated')
  })
})

describe('deleteSubscription', () => {
  it('calls delete with where', async () => {
    const chain = {
      where: vi.fn().mockResolvedValue(undefined),
    }
    const db = { delete: vi.fn().mockReturnValue(chain) } as unknown as Database

    await deleteSubscription(db, 7)

    expect(chain.where).toHaveBeenCalledOnce()
  })
})
