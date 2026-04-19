import { and, desc, eq, lt, or } from 'drizzle-orm'
import { decryptFields, encryptFields, SENSITIVE_TARGET_CONFIG } from '@/core/crypto'
import type { Database } from '@/db'
import { targets } from '@/db/schema'
import type { Cursor } from '@/server/helpers/pagination-cursor'

export type TargetInsert = {
  type: string
  name: string
  config: Record<string, unknown>
  userId?: number | null
  enabled?: boolean
}

export type TargetUpdate = Partial<Pick<TargetInsert, 'name' | 'config' | 'enabled'>>

export type TargetRow = typeof targets.$inferSelect

function encryptConfig(config: Record<string, unknown>): Record<string, unknown> {
  return encryptFields(config, SENSITIVE_TARGET_CONFIG)
}

function decryptConfig<T extends { config: Record<string, unknown> | unknown }>(row: T): T {
  if (row.config && typeof row.config === 'object') {
    return {
      ...row,
      config: decryptFields(row.config as Record<string, unknown>, SENSITIVE_TARGET_CONFIG),
    }
  }
  return row
}

export async function createTarget(db: Database, data: TargetInsert): Promise<{ id: number }> {
  const [row] = await db
    .insert(targets)
    .values({
      type: data.type,
      name: data.name,
      config: encryptConfig(data.config),
      userId: data.userId ?? null,
      enabled: data.enabled ?? true,
    })
    .returning({ id: targets.id })
  if (!row) throw new Error('createTarget: no row returned')
  return { id: row.id }
}

export async function getTarget(db: Database, id: number): Promise<TargetRow | null> {
  const [row] = await db.select().from(targets).where(eq(targets.id, id))
  return row ? decryptConfig(row) : null
}

export async function getTargetsByUser(
  db: Database,
  userId: number,
  opts: { limit?: number; cursor?: Cursor | null } = {},
): Promise<TargetRow[]> {
  const conditions = [eq(targets.userId, userId)]
  if (opts.cursor) {
    conditions.push(
      or(
        lt(targets.createdAt, new Date(opts.cursor.ts)),
        and(eq(targets.createdAt, new Date(opts.cursor.ts)), lt(targets.id, opts.cursor.id)),
      ) as NonNullable<ReturnType<typeof or>>,
    )
  }
  const base = db
    .select()
    .from(targets)
    .where(and(...conditions))
    .orderBy(desc(targets.createdAt), desc(targets.id))
  const rows = await (opts.limit ? base.limit(opts.limit) : base)
  return rows.map(decryptConfig)
}

export async function getAllTargets(
  db: Database,
  opts: { limit?: number; cursor?: Cursor | null } = {},
): Promise<TargetRow[]> {
  const conditions = []
  if (opts.cursor) {
    conditions.push(
      or(
        lt(targets.createdAt, new Date(opts.cursor.ts)),
        and(eq(targets.createdAt, new Date(opts.cursor.ts)), lt(targets.id, opts.cursor.id)),
      ) as NonNullable<ReturnType<typeof or>>,
    )
  }
  const base = conditions.length
    ? db
        .select()
        .from(targets)
        .where(and(...conditions))
    : db.select().from(targets)
  const ordered = base.orderBy(desc(targets.createdAt), desc(targets.id))
  const rows = await (opts.limit ? ordered.limit(opts.limit) : ordered)
  return rows.map(decryptConfig)
}

export async function getTargetsByType(db: Database, type: string): Promise<TargetRow[]> {
  const rows = await db.select().from(targets).where(eq(targets.type, type))
  return rows.map(decryptConfig)
}

export async function updateTarget(db: Database, id: number, data: TargetUpdate): Promise<void> {
  const encrypted = data.config ? { ...data, config: encryptConfig(data.config) } : data
  await db
    .update(targets)
    .set({ ...encrypted, updatedAt: new Date() })
    .where(eq(targets.id, id))
}

export async function deleteTarget(db: Database, id: number): Promise<void> {
  await db.delete(targets).where(eq(targets.id, id))
}
