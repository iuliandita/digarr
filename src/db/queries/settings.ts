import { and, eq, isNull, sql } from 'drizzle-orm'
import { envSettingsOverrides } from '@/config/env'
import { decryptFields, encryptFields, SENSITIVE_SETTINGS } from '@/core/crypto'
import type { Database } from '@/db'
import type { Preferences } from '@/db/schema'
import { settings } from '@/db/schema'

export type SettingsRow = typeof settings.$inferSelect
type SettingsPartial = Partial<
  Omit<SettingsRow, 'id' | 'createdAt' | 'updatedAt' | 'digestDeliveryPositions'>
>

export type SetupConfig = {
  lidarrUrl?: string
  lidarrApiKey?: string
  skipTlsVerify?: boolean
  listenbrainzUsername?: string
  listenbrainzToken?: string
  lastfmUsername?: string
  lastfmApiKey?: string
  aiProvider?: string
  aiApiKey?: string
  aiModel?: string
  aiBaseUrl?: string
  preferences?: Preferences
}

export async function getSettings(db: Database): Promise<SettingsRow | null> {
  const rows = await db.select().from(settings).limit(1)
  const row = rows[0]
  if (!row) return null

  // Merge env var fallbacks for null fields
  const overrides = envSettingsOverrides()
  const merged = { ...row }
  for (const [key, value] of Object.entries(overrides)) {
    if ((merged as Record<string, unknown>)[key] == null) {
      ;(merged as Record<string, unknown>)[key] = value
    }
  }
  return decryptFields(merged, SENSITIVE_SETTINGS)
}

export async function updateSettings(db: Database, partial: SettingsPartial): Promise<void> {
  const encrypted = encryptFields(partial, SENSITIVE_SETTINGS)
  await db
    .update(settings)
    .set({ ...encrypted, updatedAt: new Date() })
    .where(eq(settings.id, 1))
}

export async function completeSetup(db: Database, config: SetupConfig): Promise<SettingsRow> {
  const encrypted = encryptFields(config, SENSITIVE_SETTINGS)
  const rows = await db
    .insert(settings)
    .values({ ...encrypted, setupComplete: true, id: 1 })
    .onConflictDoUpdate({
      target: settings.id,
      set: { ...encrypted, setupComplete: true, updatedAt: new Date() },
    })
    .returning()
  const row = rows[0]
  if (!row) throw new Error('completeSetup: no row returned')
  return decryptFields(row, SENSITIVE_SETTINGS)
}

export async function isSetupComplete(db: Database): Promise<boolean> {
  const rows = await db.select({ setupComplete: settings.setupComplete }).from(settings).limit(1)
  return rows[0]?.setupComplete ?? false
}

export async function getDigestDeliveryPositions(
  db: Database,
): Promise<Record<string, string | null>> {
  const [row] = await db
    .select({ positions: settings.digestDeliveryPositions })
    .from(settings)
    .where(eq(settings.id, 1))
  return row?.positions ?? {}
}

export async function initializeDigestDeliveryPositions(
  db: Database,
  channelIds: string[],
): Promise<Record<string, string | null>> {
  const [row] = await db
    .select({ legacy: settings.digestLastSentAt })
    .from(settings)
    .where(eq(settings.id, 1))
  if (!row) return {}

  const positions = Object.fromEntries(
    channelIds.map((id) => [id, row.legacy?.toISOString() ?? null]),
  )
  await db
    .update(settings)
    .set({ digestDeliveryPositions: positions, updatedAt: new Date() })
    .where(and(eq(settings.id, 1), isNull(settings.digestDeliveryPositions)))
  return getDigestDeliveryPositions(db)
}

export async function setDigestDeliveryPosition(
  db: Database,
  channelId: string,
  at: Date,
): Promise<void> {
  const rows = await db
    .update(settings)
    .set({
      digestDeliveryPositions: sql`coalesce(${settings.digestDeliveryPositions}, '{}'::jsonb) || jsonb_build_object(${channelId}::text, ${at.toISOString()}::text)`,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1))
    .returning({ id: settings.id })
  if (!rows[0]) throw new Error('setDigestDeliveryPosition: settings row missing')
}
