// @vitest-environment node
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { decryptChannelSecrets, initEncryption } from '@/core/crypto'
import type { Database } from '@/db'
import { getUserById, toUserResponse } from '@/db/queries/users'
import { mergePreferences, users } from '@/db/schema'
import { userNotificationRoutes } from '@/server/routes/user-notifications'
import type { HonoEnv } from '@/server/types'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
let db: Database
let close: () => Promise<void>
let app: Hono<HonoEnv>
const channel = {
  id: 'personal',
  type: 'telegram',
  enabled: true,
  events: ['request_resolved'],
  botToken: 'private-bot-token',
  chatId: '42',
}
const headers = { 'X-Test-User': '1', 'Content-Type': 'application/json' }

beforeAll(async () => {
  const h = await makeTestDb()
  db = h.db as unknown as Database
  close = h.close
  await db.insert(users).values([
    {
      id: 1,
      username: 'owner',
      passwordHash: 'x',
      preferences: mergePreferences({ scoreThreshold: 0.65 }),
    },
    { id: 2, username: 'other', passwordHash: 'x' },
  ])
  app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    const id = c.req.header('X-Test-User')
    if (id) c.set('userId', Number(id))
    if (c.req.header('X-Test-Legacy')) c.set('legacyTokenAuth', true)
    await next()
  })
  app.route('/', userNotificationRoutes({ db, getUserById: (id) => getUserById(db, id) }))
})
afterAll(async () => close())
afterEach(() => initEncryption(undefined))

describe('personal notification channels', () => {
  it('saves only the caller channels, encrypts and masks secrets, and preserves masked edits and unrelated preferences', async () => {
    initEncryption('personal-channel-test-key')
    const path = '/api/v1/auth/me/notification-channels'
    expect(
      (
        await app.request(path, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ channels: [channel] }),
        })
      ).status,
    ).toBe(204)
    const stored = await getUserById(db, 1)
    expect(stored?.preferences?.channels?.[0]).toMatchObject({
      botToken: expect.stringMatching(/^enc:v1:/),
    })
    expect(stored?.preferences?.scoreThreshold).toBeCloseTo(0.65)
    expect((await getUserById(db, 2))?.preferences).toBeNull()
    const response = await app.request(path, { headers })
    const body = await response.json()
    expect(body.channels[0].botToken).toBe('***')
    expect(JSON.stringify(toUserResponse(stored ?? {}))).not.toContain('enc:v1:')
    expect((await app.request(path, { headers: { 'X-Test-User': '2' } })).status).toBe(200)
    expect(await (await app.request(path, { headers: { 'X-Test-User': '2' } })).json()).toEqual({
      channels: [],
    })
    expect(
      (await app.request(path, { method: 'PATCH', headers, body: JSON.stringify(body) })).status,
    ).toBe(204)
    expect(
      decryptChannelSecrets((await getUserById(db, 1))?.preferences?.channels ?? [])[0],
    ).toMatchObject({ botToken: 'private-bot-token' })
  })

  it('hides URL credentials and preserves the encrypted URL through a masked save', async () => {
    initEncryption('personal-channel-test-key')
    const url = 'https://alice:private-password@example.com/private-hook?token=private-token'
    const webhook = {
      id: 'credential-hook',
      type: 'webhook',
      enabled: true,
      events: ['request_resolved'],
      url,
    }
    const path = '/api/v1/auth/me/notification-channels'
    expect(
      (
        await app.request(path, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ channels: [webhook] }),
        })
      ).status,
    ).toBe(204)
    const response = await app.request(path, { headers })
    const body = await response.json()
    expect(body.channels[0].url).toBe('https://example.com/***?token=***')
    expect(JSON.stringify(body)).not.toMatch(/alice|private-password|private-hook|private-token/)
    expect(
      (await app.request(path, { method: 'PATCH', headers, body: JSON.stringify(body) })).status,
    ).toBe(204)
    const stored = (await getUserById(db, 1))?.preferences?.channels ?? []
    expect(stored[0]).toMatchObject({ url: expect.stringMatching(/^enc:v1:/) })
    expect(decryptChannelSecrets(stored)[0]).toMatchObject({ url })
  })

  it.each([
    { channels: [{ ...channel, allowPrivateTarget: true }] },
    { channels: [{ ...channel, events: ['digest'] }] },
    { channels: [channel, channel] },
    { channels: Array.from({ length: 21 }, (_, i) => ({ ...channel, id: String(i) })) },
    { channels: [channel], userId: 2 },
  ])('rejects unsafe or unrelated configuration %j', async (body) => {
    const response = await app.request('/api/v1/auth/me/notification-channels', {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(400)
  })

  it('requires personal authentication and rejects legacy deployment credentials', async () => {
    for (const requestHeaders of [{}, { 'X-Test-User': '1', 'X-Test-Legacy': 'true' }]) {
      const response = await app.request('/api/v1/auth/me/notification-channels', {
        headers: new Headers(requestHeaders as Record<string, string>),
      })
      expect([401, 403]).toContain(response.status)
    }
  })
})
