// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import {
  getDigestDeliveryPositions,
  initializeDigestDeliveryPositions,
  setDigestDeliveryPosition,
  updateSettings,
} from '@/db/queries/settings'
import { DEFAULT_PREFERENCES, settings } from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

const legacy = new Date('2026-10-01T00:00:00.123Z')
const delivered = new Date('2026-10-02T00:00:00.456Z')

let testDb: Awaited<ReturnType<typeof makeTestDb>>
let db: Database

beforeEach(async () => {
  testDb = await makeTestDb()
  db = testDb.db as unknown as Database
})
afterEach(async () => {
  await testDb.close()
})

describe('digest delivery positions', () => {
  it.each([legacy, null])('bootstraps the legacy timestamp %s exactly once', async (timestamp) => {
    await testDb.db.insert(settings).values({ id: 1, digestLastSentAt: timestamp })
    expect(await initializeDigestDeliveryPositions(db, ['existing'])).toEqual({
      existing: timestamp?.toISOString() ?? null,
    })
    await setDigestDeliveryPosition(db, 'existing', delivered)
    await updateSettings(db, { digestLastSentAt: delivered })
    expect(await initializeDigestDeliveryPositions(db, ['existing', 'new'])).toEqual({
      existing: delivered.toISOString(),
    })
  })

  it('records empty startup channels even with cron unset so later channels never inherit legacy', async () => {
    await testDb.db.insert(settings).values({
      id: 1,
      digestLastSentAt: legacy,
      preferences: { ...DEFAULT_PREFERENCES, digestCron: '' },
    })
    expect(await initializeDigestDeliveryPositions(db, [])).toEqual({})
    expect(await initializeDigestDeliveryPositions(db, ['later'])).toEqual({})
    const [row] = await testDb.db.select().from(settings)
    expect(row?.digestDeliveryPositions).toEqual({})
  })

  it('keeps existing delivery positions and removed-channel tombstones during initialization', async () => {
    const positions = { removed: legacy.toISOString(), pending: null }
    await testDb.db.insert(settings).values({ id: 1, digestDeliveryPositions: positions })
    const initialized = await Promise.all([
      initializeDigestDeliveryPositions(db, ['one']),
      initializeDigestDeliveryPositions(db, ['two']),
    ])
    expect(initialized).toEqual([positions, positions])
    expect(await getDigestDeliveryPositions(db)).toEqual(positions)
  })

  it('merges concurrent bound channel keys without losing preferences or tombstones', async () => {
    await testDb.db.insert(settings).values({
      id: 1,
      digestDeliveryPositions: { removed: legacy.toISOString(), pending: null },
    })
    const ids = ['normal', 'quotes"\\,{}', '__proto__', 'constructor', 'toString']
    const preferences = { ...DEFAULT_PREFERENCES, digestCron: '0 12 * * *' }
    await Promise.all([
      ...ids.map((id) => setDigestDeliveryPosition(db, id, delivered)),
      updateSettings(db, { preferences }),
    ])
    expect(await getDigestDeliveryPositions(db)).toEqual({
      removed: legacy.toISOString(),
      pending: null,
      ...Object.fromEntries(ids.map((id) => [id, delivered.toISOString()])),
    })
    const [row] = await testDb.db.select().from(settings)
    expect(row?.preferences).toEqual(preferences)
  })

  it('allows fresh startup reads but refuses delivery writes without a settings row', async () => {
    expect(await getDigestDeliveryPositions(db)).toEqual({})
    expect(await initializeDigestDeliveryPositions(db, [])).toEqual({})
    await expect(setDigestDeliveryPosition(db, 'missing', delivered)).rejects.toThrow(
      'settings row missing',
    )
  })
})
