import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import type { SubscriptionInsert } from '@/db/queries/subscriptions'
import { createSubscription, getSubscription, updateSubscription } from '@/db/queries/subscriptions'

const baseInsert: SubscriptionInsert = {
  name: 'Test Sub',
  sourceType: 'genre',
  sourceProvider: 'musicbrainz',
  sourceConfig: { genre: 'metal' },
  cron: '0 0 * * 0',
}

describe('createSubscription', () => {
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

describe('updateSubscription', () => {
  it('injects updatedAt into the update', async () => {
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }
    const db = { update: vi.fn().mockReturnValue(chain) } as unknown as Database

    await updateSubscription(db, 1, { name: 'Updated', enabled: false })

    // biome-ignore lint/style/noNonNullAssertion: mock call args
    const setArg = chain.set.mock.calls[0]![0]
    expect(setArg).toHaveProperty('updatedAt')
    expect(setArg.name).toBe('Updated')
  })
})
