// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { decryptField, initEncryption } from '@/core/crypto'
import { encryptLegacyPlaintext } from '@/core/ops/encrypt-legacy'
import { COLUMN_SITES } from '@/core/ops/encryption-sites'
import type { Database } from '@/db'
import { oauthTokens, settings, targets, users } from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

let db: Database
let close: () => Promise<void>

beforeAll(async () => {
  const result = await makeTestDb()
  db = result.db as unknown as Database
  close = result.close
})

afterAll(async () => {
  await close?.()
})

afterEach(() => {
  initEncryption(undefined)
})

function columnValues(table: string) {
  return Object.fromEntries(
    COLUMN_SITES.filter((s) => s.table === table).map((s) => [s.column, `plain-${s.column}`]),
  )
}

async function seed() {
  await db.insert(settings).values({
    preferences: {
      fanartApiKey: 'plain-fanart',
      scoreThreshold: 0.5,
      channels: [
        { id: 'w', type: 'webhook', enabled: true, events: [], url: 'https://hook.test/plain' },
        {
          id: 't',
          type: 'telegram',
          enabled: true,
          events: [],
          botToken: 'plain-bot',
          chatId: '1',
        },
      ],
    },
  } as never)
  const [user] = await db
    .insert(users)
    .values({
      username: 'legacy',
      passwordHash: 'x',
      preferences: {
        fanartApiKey: 'plain-uf',
        channels: [
          {
            id: 'personal',
            type: 'telegram',
            enabled: true,
            events: ['request_resolved'],
            botToken: 'plain-personal-bot',
            chatId: '1',
          },
        ],
      } as never,
    })
    .returning()
  if (!user) throw new Error('fixture missing')
  await db.insert(oauthTokens).values({
    userId: user.id,
    provider: 'spotify',
    accessToken: 'plain-access',
    refreshToken: 'plain-refresh',
    clientSecret: 'plain-client-secret',
    expiresAt: new Date(),
  })
  await db.insert(targets).values({
    type: 'jellyfin',
    name: 'J',
    config: { url: 'http://jf.test', apiKey: 'plain-target-key' },
  })
  for (const table of ['settings', 'users']) {
    const values = columnValues(table)
    const assignments = Object.entries(values)
      .map(([col, val]) => `"${col}" = '${val}'`)
      .join(', ')
    await db.execute(`UPDATE "${table}" SET ${assignments}` as never)
  }
  await db.execute(`UPDATE "users" SET "plex_token" = ''` as never)
}

async function readAll() {
  const out: Record<string, unknown> = {}
  for (const { table, column } of COLUMN_SITES) {
    const { rows } = await db.execute(`SELECT "${column}" AS v FROM "${table}" LIMIT 1` as never)
    out[`${table}.${column}`] = (rows[0] as { v: unknown } | undefined)?.v
  }
  const [s] = (await db.execute('SELECT preferences FROM settings LIMIT 1' as never)).rows as {
    preferences: Record<string, unknown> & { channels: Record<string, unknown>[] }
  }[]
  const [u] = (await db.execute('SELECT preferences FROM users LIMIT 1' as never)).rows as {
    preferences: Record<string, unknown> & { channels: Record<string, unknown>[] }
  }[]
  const [t] = (await db.execute('SELECT config FROM targets LIMIT 1' as never)).rows as {
    config: Record<string, unknown>
  }[]
  out['settings.fanart'] = s?.preferences.fanartApiKey
  out['settings.webhook'] = s?.preferences.channels[0]?.url
  out['settings.bot'] = s?.preferences.channels[1]?.botToken
  out['users.fanart'] = u?.preferences.fanartApiKey
  out['users.bot'] = u?.preferences.channels[0]?.botToken
  out['targets.apiKey'] = t?.config.apiKey
  return { out, scoreThreshold: s?.preferences.scoreThreshold, targetUrl: t?.config.url }
}

describe('encryptLegacyPlaintext', () => {
  it('does nothing without a configured key', async () => {
    await seed()
    await expect(encryptLegacyPlaintext(db)).resolves.toBe(0)
    const { out } = await readAll()
    expect(out['targets.apiKey']).toBe('plain-target-key')
  })

  it('encrypts every legacy plaintext site once and leaves other values alone', async () => {
    const before = (await readAll()).out
    initEncryption('legacy-backfill-test-key')

    expect(await encryptLegacyPlaintext(db)).toBeGreaterThan(0)
    const { out, scoreThreshold, targetUrl } = await readAll()

    for (const [site, value] of Object.entries(out)) {
      if (site === 'users.plex_token') {
        expect(value).toBe('')
        continue
      }
      expect(value, site).toMatch(/^enc:v1:/)
      expect(decryptField(value as string), site).toBe(before[site])
    }
    expect(scoreThreshold).toBe(0.5)
    expect(targetUrl).toBe('http://jf.test')

    await expect(encryptLegacyPlaintext(db)).resolves.toBe(0)
    expect((await readAll()).out).toEqual(out)
  })
})
