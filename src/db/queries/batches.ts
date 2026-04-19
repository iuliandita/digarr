import { and, desc, eq, lt, or } from 'drizzle-orm'
import type { Database } from '@/db'
import { recommendationBatches } from '@/db/schema'
import type { Cursor } from '@/server/helpers/pagination-cursor'

export type BatchRow = typeof recommendationBatches.$inferSelect

export type BatchStats = {
  discovered: number
  filtered: number
  added: number
  failed: number
}

export async function createBatch(
  db: Database,
  sourceConfig: Record<string, unknown>,
): Promise<BatchRow> {
  const rows = await db
    .insert(recommendationBatches)
    .values({ sourceConfig, status: 'running' })
    .returning()
  const row = rows[0]
  if (!row) throw new Error('createBatch: no row returned')
  return row
}

export async function completeBatch(db: Database, id: number, stats: BatchStats): Promise<void> {
  await db
    .update(recommendationBatches)
    .set({ status: 'completed', stats })
    .where(eq(recommendationBatches.id, id))
}

export async function failBatch(db: Database, id: number): Promise<void> {
  await db
    .update(recommendationBatches)
    .set({ status: 'failed' })
    .where(eq(recommendationBatches.id, id))
}

export async function listBatches(
  db: Database,
  opts: { limit?: number; cursor?: Cursor | null } = {},
): Promise<BatchRow[]> {
  const conditions = []
  if (opts.cursor) {
    conditions.push(
      or(
        lt(recommendationBatches.createdAt, new Date(opts.cursor.ts)),
        and(
          eq(recommendationBatches.createdAt, new Date(opts.cursor.ts)),
          lt(recommendationBatches.id, opts.cursor.id),
        ),
      ) as NonNullable<ReturnType<typeof or>>,
    )
  }
  const base = conditions.length
    ? db
        .select()
        .from(recommendationBatches)
        .where(and(...conditions))
    : db.select().from(recommendationBatches)
  const ordered = base.orderBy(
    desc(recommendationBatches.createdAt),
    desc(recommendationBatches.id),
  )
  return opts.limit ? ordered.limit(opts.limit) : ordered
}

export async function getBatch(db: Database, id: number): Promise<BatchRow | null> {
  const rows = await db
    .select()
    .from(recommendationBatches)
    .where(eq(recommendationBatches.id, id))
    .limit(1)
  return rows[0] ?? null
}
