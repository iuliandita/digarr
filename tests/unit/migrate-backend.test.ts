import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateBackend } from '@/core/ops/migrate-backend'
import * as schema from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

function tgt(name: string) {
  return join(process.env.DIGARR_MIGRATE_DATA_ROOT as string, name)
}

// Seed a minimal but representative dataset (user + a couple stateful rows).
async function seedFullFixtures(db: any) {
  const [user] = await db
    .insert(schema.users)
    .values({ username: 'mig', passwordHash: 'x' })
    .returning()
  await db.insert(schema.settings).values({ setupComplete: true })
  await db.insert(schema.genres).values({ name: 'Synthwave', slug: 'synthwave', source: 'manual' })
  return user
}

describe('migrateBackend', () => {
  beforeEach(() => {
    process.env.DIGARR_MIGRATE_DATA_ROOT = mkdtempSync(join(tmpdir(), 'digarr-mig-'))
  })
  afterEach(() => {
    delete process.env.DIGARR_MIGRATE_DATA_ROOT
  })

  it('refuses when the pipeline is running', async () => {
    const src = await makeTestDb()
    await expect(
      migrateBackend({
        sourceDb: src.db as never,
        target: { backend: 'pglite', path: tgt('a') },
        isPipelineRunning: () => true,
      }),
    ).rejects.toThrow(/pipeline is running/i)
    await src.close()
  })

  it('copies all data and verifies counts AND content hashes', async () => {
    const src = await makeTestDb()
    await seedFullFixtures(src.db)
    const report = await migrateBackend({
      sourceDb: src.db as never,
      target: { backend: 'pglite', path: tgt('ok') },
      isPipelineRunning: () => false,
    })
    expect(report.ok).toBe(true)
    expect(report.verified).toBe(true)
    expect(report.contentVerified).toBe(true)
    expect(report.tablesMigrated.users).toBeGreaterThan(0)
    expect(report.excludedTables).toEqual(['sessions', 'rateLimitBuckets'])
    expect(report.mismatches).toEqual([])
    expect(report.targetEnvHint).toMatch(/DB_PATH=/)
    await src.close()
  })

  it('refuses a non-empty target without overwrite, succeeds with overwrite', async () => {
    const src = await makeTestDb()
    await seedFullFixtures(src.db)
    const path = tgt('reuse')
    await migrateBackend({
      sourceDb: src.db as never,
      target: { backend: 'pglite', path },
      isPipelineRunning: () => false,
    })
    await expect(
      migrateBackend({
        sourceDb: src.db as never,
        target: { backend: 'pglite', path },
        isPipelineRunning: () => false,
      }),
    ).rejects.toThrow(/not empty/i)
    const report = await migrateBackend({
      sourceDb: src.db as never,
      target: { backend: 'pglite', path },
      isPipelineRunning: () => false,
      overwrite: true,
    })
    expect(report.verified).toBe(true)
    await src.close()
  })

  it('refuses when the target is the same cluster as the source (fingerprint match)', async () => {
    // File-backed source so a second handle on the same dir yields the same system_identifier.
    const src = await makeTestDb({ path: tgt('self') })
    await expect(
      migrateBackend({
        sourceDb: src.db as never,
        target: { backend: 'pglite', path: tgt('self') },
        isPipelineRunning: () => false,
      }),
    ).rejects.toThrow(/same .* source/i)
    await src.close()
  })
})
