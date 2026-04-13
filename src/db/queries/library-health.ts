import { eq } from 'drizzle-orm'
import type { LibraryHealthState } from '@/core/library/types'
import type { Database } from '@/db'
import { libraryHealthState } from '@/db/schema'

export async function getLibraryHealthState(db: Database): Promise<LibraryHealthState | null> {
  const [row] = await db
    .select()
    .from(libraryHealthState)
    .where(eq(libraryHealthState.id, 1))
    .limit(1)
  if (!row) return null

  return {
    checks: row.checks,
    lastStartedAt: row.lastStartedAt,
    lastCompletedAt: row.lastCompletedAt,
    lastError: row.lastError,
  }
}

export async function markLibraryHealthScanStarted(db: Database): Promise<void> {
  await db
    .insert(libraryHealthState)
    .values({
      id: 1,
      lastStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: libraryHealthState.id,
      set: {
        lastStartedAt: new Date(),
        updatedAt: new Date(),
      },
    })
}

export async function saveLibraryHealthState(
  db: Database,
  input: {
    checks: LibraryHealthState['checks']
    lastCompletedAt: Date
    lastError: string | null
  },
): Promise<void> {
  await db
    .insert(libraryHealthState)
    .values({
      id: 1,
      checks: input.checks,
      lastCompletedAt: input.lastCompletedAt,
      lastError: input.lastError,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: libraryHealthState.id,
      set: {
        checks: input.checks,
        lastCompletedAt: input.lastCompletedAt,
        lastError: input.lastError,
        updatedAt: new Date(),
      },
    })
}
