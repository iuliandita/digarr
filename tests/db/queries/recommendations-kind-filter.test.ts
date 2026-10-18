import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { listRecommendations } from '@/db/queries/recommendations'

const { mockedEq, mockedAnd, mockedCount, mockedDesc } = vi.hoisted(() => ({
  mockedEq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  mockedAnd: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  mockedCount: vi.fn(() => ({ op: 'count' })),
  mockedDesc: vi.fn((col: unknown) => ({ op: 'desc', col })),
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const original = await importOriginal<typeof import('drizzle-orm')>()
  return { ...original, eq: mockedEq, and: mockedAnd, count: mockedCount, desc: mockedDesc }
})

beforeEach(() => {
  mockedEq.mockClear()
  mockedAnd.mockClear()
  mockedCount.mockClear()
  mockedDesc.mockClear()
})

function makeChainSelectDb(rows: unknown[] = []): Database {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn().mockReturnValue(chain)
  chain.innerJoin = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.orderBy = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  chain.offset = vi.fn().mockResolvedValue(rows)
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock so the chain resolves whether or not the caller calls .offset()
  chain.then = (resolve: (value: unknown) => void) => resolve(rows)
  return {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn(),
  } as unknown as Database
}

describe('listRecommendations kind filter', () => {
  it.each(['album', 'artist'] as const)('applies a kind condition for kind="%s"', async (kind) => {
    await listRecommendations(makeChainSelectDb([]), { kind })
    expect(mockedEq.mock.calls.map((args) => args[1])).toContain(kind)
  })

  it.each([{}, { kind: undefined }])('does not apply a kind condition for %j', async (params) => {
    await listRecommendations(makeChainSelectDb([]), params)
    const eqCalls = mockedEq.mock.calls.map((args) => args[1])
    expect(eqCalls).not.toContain('album')
    expect(eqCalls).not.toContain('artist')
  })
})
