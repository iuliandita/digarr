import { sql } from 'drizzle-orm'
import {
  encryptedChannelFieldsFor,
  encryptField,
  isEncryptionEnabled,
  SENSITIVE_TARGET_CONFIG,
} from '@/core/crypto'
import { COLUMN_SITES, NESTED_SITES } from './encryption-sites'
import type { OpsDb } from './types'

const PREFIX = 'enc:v1:'

function needsEncryption(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !value.startsWith(PREFIX)
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Encrypt the listed string keys of a JSON object; returns null when nothing changed. */
function encryptKeys(obj: JsonObject, keys: readonly string[]): JsonObject | null {
  let next: JsonObject | null = null
  for (const key of keys) {
    const value = obj[key]
    if (!needsEncryption(value)) continue
    next ??= { ...obj }
    next[key] = encryptField(value)
  }
  return next
}

function encryptPreferences(prefs: JsonObject): JsonObject | null {
  let next = encryptKeys(
    prefs,
    NESTED_SITES.map((site) => site.path[0] as string),
  )
  if (Array.isArray(prefs.channels)) {
    let changed = false
    const channels = prefs.channels.map((channel: unknown) => {
      if (!isObject(channel) || typeof channel.type !== 'string') return channel
      const updated = encryptKeys(channel, encryptedChannelFieldsFor(channel.type))
      if (!updated) return channel
      changed = true
      return updated
    })
    if (changed) next = { ...(next ?? prefs), channels }
  }
  return next
}

/**
 * Encrypt values stored before DIGARR_ENCRYPTION_KEY was configured. Safe to
 * re-run: only non-empty values without the ciphertext prefix are touched, and
 * every write is conditional on the value it read. No-op without a key.
 */
export async function encryptLegacyPlaintext(db: OpsDb): Promise<number> {
  if (!isEncryptionEnabled()) return 0
  let rewritten = 0

  for (const { table, column } of COLUMN_SITES) {
    const t = sql.identifier(table)
    const c = sql.identifier(column)
    const rows = (
      await db.execute(
        sql`SELECT id, ${c} AS v FROM ${t} WHERE ${c} IS NOT NULL AND ${c} <> '' AND ${c} NOT LIKE ${`${PREFIX}%`}`,
      )
    ).rows as Array<{ id: number; v: string }>
    for (const row of rows) {
      const result = await db.execute(
        sql`UPDATE ${t} SET ${c} = ${encryptField(row.v)} WHERE id = ${row.id} AND ${c} = ${row.v} RETURNING id`,
      )
      rewritten += result.rows.length
    }
  }

  for (const table of ['settings', 'users']) {
    const t = sql.identifier(table)
    const rows = (
      await db.execute(sql`SELECT id, preferences FROM ${t} WHERE preferences IS NOT NULL`)
    ).rows as Array<{ id: number; preferences: unknown }>
    for (const row of rows) {
      if (!isObject(row.preferences)) continue
      const next = encryptPreferences(row.preferences)
      if (!next) continue
      const result = await db.execute(
        sql`UPDATE ${t} SET preferences = ${JSON.stringify(next)}::jsonb
            WHERE id = ${row.id} AND preferences = ${JSON.stringify(row.preferences)}::jsonb
            RETURNING id`,
      )
      rewritten += result.rows.length
    }
  }

  const targets = (await db.execute(sql`SELECT id, config FROM targets`)).rows as Array<{
    id: number
    config: unknown
  }>
  for (const row of targets) {
    if (!isObject(row.config)) continue
    const next = encryptKeys(row.config, SENSITIVE_TARGET_CONFIG)
    if (!next) continue
    const result = await db.execute(
      sql`UPDATE targets SET config = ${JSON.stringify(next)}::jsonb
          WHERE id = ${row.id} AND config = ${JSON.stringify(row.config)}::jsonb
          RETURNING id`,
    )
    rewritten += result.rows.length
  }

  return rewritten
}
