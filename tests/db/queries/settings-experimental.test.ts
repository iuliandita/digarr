// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import {
  completeSetup,
  getSettings,
  initializeExperimentalIntegrations,
  updateSettings,
} from '@/db/queries/settings'
import { DEFAULT_PREFERENCES, oauthTokens, settings, users } from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
let testDb: Awaited<ReturnType<typeof makeTestDb>>
let db: Database
beforeEach(async () => {
  testDb = await makeTestDb()
  db = testDb.db as unknown as Database
})
afterEach(async () => {
  await testDb.close()
})

describe('experimental integration upgrade default', () => {
  it.each([
    {
      name: 'fresh installation',
      setupComplete: false,
      app: false,
      user: false,
      explicit: undefined,
      expected: false,
    },
    {
      name: 'legacy installation with only Bandcamp',
      setupComplete: true,
      app: false,
      user: false,
      explicit: undefined,
      expected: false,
    },
    {
      name: 'TIDAL app credentials',
      setupComplete: false,
      app: true,
      user: false,
      explicit: undefined,
      expected: true,
    },
    {
      name: 'another user TIDAL connection',
      setupComplete: false,
      app: false,
      user: true,
      explicit: undefined,
      expected: true,
    },
    {
      name: 'explicit opt-out',
      setupComplete: true,
      app: true,
      user: true,
      explicit: false,
      expected: false,
    },
    {
      name: 'explicit opt-in',
      setupComplete: false,
      app: false,
      user: false,
      explicit: true,
      expected: true,
    },
  ])(
    'initializes $name once without overwriting preferences',
    async ({ setupComplete, app, user, explicit, expected }) => {
      await testDb.db.insert(settings).values({
        id: 1,
        setupComplete,
        tidalClientId: app ? 'configured-app' : null,
        tidalClientSecret: app ? 'saved-secret' : null,
        preferences: {
          ...DEFAULT_PREFERENCES,
          showExperimentalIntegrations: explicit,
          scoreThreshold: 0.71,
        },
      })
      if (user) {
        await testDb.db
          .insert(users)
          .values({ id: 7, username: 'other-user', passwordHash: 'unused' })
        await testDb.db
          .insert(oauthTokens)
          .values({ userId: 7, provider: 'tidal', accessToken: 'saved', expiresAt: new Date() })
      }
      await initializeExperimentalIntegrations(db)
      expect((await getSettings(db))?.preferences).toMatchObject({
        showExperimentalIntegrations: expected,
        scoreThreshold: 0.71,
      })
      await updateSettings(db, {
        preferences: { ...DEFAULT_PREFERENCES, showExperimentalIntegrations: !expected },
      })
      await initializeExperimentalIntegrations(db)
      expect((await getSettings(db))?.preferences?.showExperimentalIntegrations).toBe(!expected)
    },
  )

  it('defaults new manual and environment-driven setups to off across restarts', async () => {
    await initializeExperimentalIntegrations(db)
    await completeSetup(db, {})
    await initializeExperimentalIntegrations(db)
    expect((await getSettings(db))?.preferences?.showExperimentalIntegrations).toBe(false)
  })
  it('preserves existing preferences and explicit visibility when completing an unfinished setup', async () => {
    await testDb.db.insert(settings).values({
      id: 1,
      preferences: {
        ...DEFAULT_PREFERENCES,
        scoreThreshold: 0.73,
        showExperimentalIntegrations: true,
      },
    })
    await completeSetup(db, {})
    expect((await getSettings(db))?.preferences).toMatchObject({
      scoreThreshold: 0.73,
      showExperimentalIntegrations: true,
    })
  })
})
