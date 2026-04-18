import { desc, eq } from 'drizzle-orm'
import type { Database } from '@/db'
import { recommendationBatches } from '@/db/schema'

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

export async function listBatches(db: Database): Promise<BatchRow[]> {
  return db.select().from(recommendationBatches).orderBy(desc(recommendationBatches.createdAt))
}

export async function getBatch(db: Database, id: number): Promise<BatchRow | null> {
  const rows = await db
    .select()
    .from(recommendationBatches)
    .where(eq(recommendationBatches.id, id))
    .limit(1)
  return rows[0] ?? null
}
