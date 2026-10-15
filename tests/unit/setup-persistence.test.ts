// @vitest-environment node
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initEncryption } from '@/core/crypto'
import type { Database } from '@/db'
import { getSettings, isSetupComplete } from '@/db/queries/settings'
import {
  completeSetupWithServices,
  SetupAlreadyCompleteError,
  SetupOwnerRequiredError,
} from '@/db/queries/setup'
import { getTargetsByUser } from '@/db/queries/targets'
import { getUserConnections } from '@/db/queries/users'
import { settings, targets, users } from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

const config = {
  aiProvider: 'ollama',
  aiModel: 'llama3',
  aiApiKey: 'ai-key',
  lidarrUrl: 'http://lidarr:8686',
  lidarrApiKey: 'lidarr-key',
  skipTlsVerify: true,
}
const emby = { url: 'http://emby:8096', apiKey: 'emby-key', userId: 'emby-owner' }

describe('atomic setup persistence', () => {
  let db: Database
  let close: () => Promise<void>
  let ownerId: number
  let otherId: number

  beforeEach(async () => {
    const testDb = await makeTestDb()
    db = testDb.db as unknown as Database
    close = testDb.close
    initEncryption('setup-test-encryption-key')
    const [owner, other] = await db
      .insert(users)
      .values([
        { username: 'owner', passwordHash: 'hash', isAdmin: true },
        { username: 'other', passwordHash: 'hash' },
      ])
      .returning()
    if (!owner || !other) throw new Error('Test owners were not inserted')
    ownerId = owner.id
    otherId = other.id
    await db.insert(settings).values({ id: 1, setupComplete: false, aiModel: 'previous-model' })
  })
  afterEach(async () => {
    await close()
    initEncryption(undefined)
  })

  it('commits settings, both targets and only the owner connection with encrypted credentials', async () => {
    await completeSetupWithServices(db, config, { userId: ownerId, emby })
    expect(await isSetupComplete(db)).toBe(true)
    expect(await getSettings(db)).toEqual(expect.objectContaining(config))
    expect(await getUserConnections(db, ownerId)).toEqual(
      expect.objectContaining({
        embyUrl: emby.url,
        embyApiKey: emby.apiKey,
        embyUserId: emby.userId,
      }),
    )
    expect((await getUserConnections(db, otherId))?.embyApiKey).toBeNull()
    const savedTargets = await getTargetsByUser(db, ownerId)
    expect(savedTargets).toHaveLength(2)
    expect(savedTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'lidarr',
          config: { url: config.lidarrUrl, apiKey: config.lidarrApiKey, skipTlsVerify: true },
        }),
        expect.objectContaining({
          type: 'emby-playlist',
          config: { ...emby, skipTlsVerify: true },
        }),
      ]),
    )
    expect(await getTargetsByUser(db, otherId)).toEqual([])
    const [rawOwner] = await db.select().from(users).where(eq(users.id, ownerId))
    const [rawSettings] = await db.select().from(settings)
    const rawTargets = await db.select().from(targets)
    expect(rawOwner?.embyApiKey).toMatch(/^enc:v1:/)
    expect(rawSettings?.lidarrApiKey).toMatch(/^enc:v1:/)
    expect(rawSettings?.aiApiKey).toMatch(/^enc:v1:/)
    for (const target of rawTargets)
      expect((target.config as Record<string, unknown>).apiKey).toMatch(/^enc:v1:/)
  })

  it.each(['connection', 'target', 'completion'])(
    'rolls back every write on %s failure and allows a clean retry',
    async (boundary) => {
      const table =
        boundary === 'connection' ? 'users' : boundary === 'target' ? 'targets' : 'settings'
      const operation = boundary === 'target' ? 'INSERT' : 'UPDATE'
      const condition =
        boundary === 'completion'
          ? 'WHEN (NEW.setup_complete = true)'
          : boundary === 'target'
            ? "WHEN (NEW.type = 'emby-playlist')"
            : ''
      await db.execute(
        sql.raw(
          `CREATE FUNCTION reject_setup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected setup failure'; END; $$`,
        ),
      )
      await db.execute(
        sql.raw(
          `CREATE TRIGGER reject_setup BEFORE ${operation} ON ${table} FOR EACH ROW ${condition} EXECUTE FUNCTION reject_setup()`,
        ),
      )
      await expect(
        completeSetupWithServices(db, config, { userId: ownerId, emby }),
      ).rejects.toThrow()
      expect(await isSetupComplete(db)).toBe(false)
      expect((await getSettings(db))?.aiModel).toBe('previous-model')
      expect((await getUserConnections(db, ownerId))?.embyApiKey).toBeNull()
      expect(await db.select().from(targets)).toEqual([])
      await db.execute(sql.raw(`DROP TRIGGER reject_setup ON ${table}`))
      await completeSetupWithServices(db, config, { userId: ownerId, emby })
      expect(await isSetupComplete(db)).toBe(true)
      expect(await getTargetsByUser(db, ownerId)).toHaveLength(2)
    },
  )

  it.each([undefined, 9999])(
    'rejects missing owner %s before changing settings',
    async (userId) => {
      await expect(completeSetupWithServices(db, config, { userId, emby })).rejects.toBeInstanceOf(
        SetupOwnerRequiredError,
      )
      expect(await isSetupComplete(db)).toBe(false)
      expect((await getSettings(db))?.aiModel).toBe('previous-model')
      expect(await db.select().from(targets)).toEqual([])
    },
  )

  it('allows only one concurrent completion and rejects repeated completion without duplicate targets', async () => {
    await db.delete(settings)
    const results = await Promise.allSettled([
      completeSetupWithServices(db, config, { userId: ownerId, emby }),
      completeSetupWithServices(db, config, { userId: otherId, emby }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      SetupAlreadyCompleteError,
    )
    await expect(
      completeSetupWithServices(db, config, { userId: ownerId, emby }),
    ).rejects.toBeInstanceOf(SetupAlreadyCompleteError)
    expect(await db.select().from(targets)).toHaveLength(2)
    const owners = new Set((await db.select().from(targets)).map((target) => target.userId))
    expect(owners.size).toBe(1)
  })
})
