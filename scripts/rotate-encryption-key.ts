#!/usr/bin/env bun

/**
 * Re-encrypt every encrypted column with the current primary key.
 *
 * Expected use flow (see docs/runbooks/encryption-key-rotation.md):
 *   1. Deploy with DIGARR_ENCRYPTION_KEY=<old> DIGARR_ENCRYPTION_KEY_NEXT=<new>
 *   2. Deploy with DIGARR_ENCRYPTION_KEY=<new> DIGARR_ENCRYPTION_KEY_NEXT=<old>
 *   3. Run this script. It reads every enc:v1 column, decrypts through the
 *      primary/next/legacy chain, and re-encrypts with the primary key so
 *      all ciphertext is readable by the primary alone.
 *   4. Re-run with only the primary key to verify every ciphertext.
 *   5. Deploy with DIGARR_ENCRYPTION_KEY=<new> (NEXT unset).
 *
 * Safe to re-run: values already readable by the primary are still
 * re-encrypted (fresh IV each pass).
 *
 * Usage: bun scripts/rotate-encryption-key.ts
 */

import { sql } from 'drizzle-orm'
import { envConfig } from '../src/config/env'

// Import env/crypto via side effects before instantiating the DB pool so the
// key derivation runs with whatever env is set at invocation.
import { decryptField, encryptField, initEncryption } from '../src/core/crypto'
import { closeDb, db, dbBackend } from '../src/db'
import { COLUMN_SITES, NESTED_SITES, type RotationSite } from './rotation-sites'

initEncryption(envConfig.encryptionKey, envConfig.encryptionKeyNext)

if (!envConfig.encryptionKey) {
  console.error('DIGARR_ENCRYPTION_KEY must be set to rotate keys')
  process.exit(1)
}
console.log(`using ${dbBackend} backend`)

type RotationResult = { scanned: number; rewritten: number; failures: number }

function decryptForRotation(value: string): string {
  const plain = decryptField(value)
  if (plain == null || plain === value) {
    throw new Error('Malformed encrypted value')
  }
  return plain
}

// `targets.config` is a jsonb with variable shape. Each row may have any
// combination of encrypted-looking keys (apiKey/password/token/secret). Handle
// it by walking the blob and re-encrypting any string value that starts with
// the `enc:v1:` prefix.
async function rotateTargetsConfig(): Promise<RotationResult> {
  const rows = (await db.execute(sql`SELECT id, config FROM targets`)).rows as Array<{
    id: number
    config: Record<string, unknown> | null
  }>
  let rewritten = 0
  let failures = 0
  for (const row of rows) {
    if (!row.config || typeof row.config !== 'object') continue
    let changed = false
    const next: Record<string, unknown> = { ...row.config }
    for (const [k, v] of Object.entries(row.config)) {
      if (typeof v === 'string' && v.startsWith('enc:v1:')) {
        try {
          const plain = decryptForRotation(v)
          const re = encryptField(plain)
          if (re !== v) {
            next[k] = re
            changed = true
          }
        } catch (err) {
          failures++
          console.error(`  skip targets.config id=${row.id} key=${k}: ${(err as Error).message}`)
        }
      }
    }
    if (changed) {
      await db.execute(sql`UPDATE targets SET config = ${next} WHERE id = ${row.id}`)
      rewritten++
    }
  }
  return { scanned: rows.length, rewritten, failures }
}

async function rotateColumn(site: RotationSite): Promise<RotationResult> {
  const rows = (
    await db.execute(
      sql.raw(
        `SELECT id, "${site.column}" AS v FROM "${site.table}" WHERE "${site.column}" LIKE 'enc:v1:%'`,
      ),
    )
  ).rows as Array<{ id: number; v: string }>
  let rewritten = 0
  let failures = 0
  for (const row of rows) {
    try {
      const plain = decryptForRotation(row.v)
      const re = encryptField(plain)
      if (re !== row.v) {
        await db.execute(
          sql`UPDATE ${sql.identifier(site.table)}
              SET ${sql.identifier(site.column)} = ${re}
              WHERE id = ${row.id}`,
        )
        rewritten++
      }
    } catch (err) {
      failures++
      console.error(`  skip ${site.table}.${site.column} id=${row.id}: ${(err as Error).message}`)
    }
  }
  return { scanned: rows.length, rewritten, failures }
}

async function rotateNested(site: {
  table: string
  column: string
  path: string[]
}): Promise<RotationResult> {
  const rows = (
    await db.execute(
      sql.raw(
        `SELECT id, "${site.column}" AS blob FROM "${site.table}" WHERE "${site.column}" IS NOT NULL`,
      ),
    )
  ).rows as Array<{ id: number; blob: Record<string, unknown> | null }>
  let rewritten = 0
  let failures = 0
  for (const row of rows) {
    if (!row.blob || typeof row.blob !== 'object') continue
    let cursor: Record<string, unknown> = row.blob
    for (let i = 0; i < site.path.length - 1; i++) {
      const seg = site.path[i]
      if (!seg) break
      const sub = cursor[seg]
      if (!sub || typeof sub !== 'object') {
        cursor = {}
        break
      }
      cursor = sub as Record<string, unknown>
    }
    const leaf = site.path[site.path.length - 1]
    if (!leaf) continue
    const v = cursor[leaf]
    if (typeof v !== 'string' || !v.startsWith('enc:v1:')) continue
    try {
      const plain = decryptForRotation(v)
      const re = encryptField(plain)
      if (re !== v) {
        cursor[leaf] = re
        await db.execute(
          sql`UPDATE ${sql.identifier(site.table)}
              SET ${sql.identifier(site.column)} = ${row.blob}
              WHERE id = ${row.id}`,
        )
        rewritten++
      }
    } catch (err) {
      failures++
      console.error(
        `  skip ${site.table}.${site.column}.${site.path.join('.')} id=${row.id}: ${(err as Error).message}`,
      )
    }
  }
  return { scanned: rows.length, rewritten, failures }
}

async function main(): Promise<void> {
  let totalScanned = 0
  let totalRewritten = 0
  let totalFailures = 0
  for (const site of COLUMN_SITES) {
    process.stdout.write(`${site.table}.${site.column} ... `)
    const { scanned, rewritten, failures } = await rotateColumn(site)
    console.log(`${scanned} scanned, ${rewritten} rewritten`)
    totalScanned += scanned
    totalRewritten += rewritten
    totalFailures += failures
  }
  for (const site of NESTED_SITES) {
    const label = `${site.table}.${site.column}.${site.path.join('.')}`
    process.stdout.write(`${label} ... `)
    const { scanned, rewritten, failures } = await rotateNested(site)
    console.log(`${scanned} scanned, ${rewritten} rewritten`)
    totalScanned += scanned
    totalRewritten += rewritten
    totalFailures += failures
  }
  process.stdout.write('targets.config ... ')
  const { scanned, rewritten, failures } = await rotateTargetsConfig()
  console.log(`${scanned} scanned, ${rewritten} rewritten`)
  totalScanned += scanned
  totalRewritten += rewritten
  totalFailures += failures

  if (totalFailures > 0) {
    throw new Error(`rotation incomplete: ${totalFailures} encrypted values could not be rewritten`)
  }

  console.log(
    `\nrotation complete: ${totalRewritten} records rewritten across ${totalScanned} records scanned`,
  )
  await closeDb()
}

main().catch(async (err) => {
  console.error(err)
  await closeDb()
  process.exit(1)
})
