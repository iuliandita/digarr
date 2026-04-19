import { and, desc, eq, lt, or } from 'drizzle-orm'
import type { DiscoveryModeSubscriptionConfig } from '@/core/subscriptions/types'
import type { Database } from '@/db'
import { subscriptions } from '@/db/schema'
import type { Cursor } from '@/server/helpers/pagination-cursor'
import { getBatch } from './batches'

type SubscriptionRow = typeof subscriptions.$inferSelect

export type SubscriptionInsert = {
  name: string
  userId?: number | null
  enabled?: boolean
  sourceType: string
  sourceProvider: string
  sourceConfig: Record<string, unknown> | DiscoveryModeSubscriptionConfig
  maxArtistsPerRun?: number
  listenerRange?: { min?: number; max?: number } | null
  cron: string
  action?: string
  scoreThreshold?: number | null
  scoringWeightPreset?: string | null
  scoringWeightOverrides?: Record<string, number> | null
}

export type SubscriptionUpdate = Partial<SubscriptionInsert> & {
  lastRunAt?: Date | null
  lastResultCount?: number | null
  lastError?: string | null
  enabled?: boolean
}

export async function createSubscription(
  db: Database,
  data: SubscriptionInsert,
): Promise<SubscriptionRow> {
  const rows = await db.insert(subscriptions).values(data).returning()
  const row = rows[0]
  if (!row) throw new Error('createSubscription: no row returned')
  return row
}

export async function getSubscription(db: Database, id: number): Promise<SubscriptionRow | null> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1)
  return rows[0] ?? null
}

export async function getSubscriptionsByUser(
  db: Database,
  userId: number,
  opts: { limit?: number; cursor?: Cursor | null } = {},
): Promise<SubscriptionRow[]> {
  const conditions = [eq(subscriptions.userId, userId)]
  if (opts.cursor) {
    // Keyset: rows ordered by (createdAt DESC, id DESC); fetch strictly older.
    conditions.push(
      or(
        lt(subscriptions.createdAt, new Date(opts.cursor.ts)),
        and(
          eq(subscriptions.createdAt, new Date(opts.cursor.ts)),
          lt(subscriptions.id, opts.cursor.id),
        ),
      ) as NonNullable<ReturnType<typeof or>>,
    )
  }
  const base = db
    .select()
    .from(subscriptions)
    .where(and(...conditions))
    .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
  return opts.limit ? base.limit(opts.limit) : base
}

export async function getEnabledSubscriptions(db: Database): Promise<SubscriptionRow[]> {
  return db.select().from(subscriptions).where(eq(subscriptions.enabled, true))
}

export async function updateSubscription(
  db: Database,
  id: number,
  data: SubscriptionUpdate,
): Promise<void> {
  await db
    .update(subscriptions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(subscriptions.id, id))
}

export async function deleteSubscription(db: Database, id: number): Promise<void> {
  await db.delete(subscriptions).where(eq(subscriptions.id, id))
}

export async function getSubscriptionBatchStats(
  db: Database,
  batchId: number,
): Promise<{ added: number } | null> {
  const batch = await getBatch(db, batchId)
  if (!batch || !batch.stats || typeof batch.stats !== 'object') {
    return null
  }

  const added = (batch.stats as Record<string, unknown>).added
  return { added: typeof added === 'number' ? added : 0 }
}
