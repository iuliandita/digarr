// @vitest-environment node
import { readFileSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { envConfig } from '@/config/env'
import { createBackup, restoreBackup } from '@/core/ops/backup'
import type { BackupFile } from '@/core/ops/types'
import { clearAllSessions, createSession } from '@/core/sessions'
import type { Database } from '@/db'
import { apiTokenQueries, hashApiToken } from '@/db/queries/api-tokens'
import { type ApiTokenScope, apiTokens, users } from '@/db/schema'
import { authGuard } from '@/server/middleware/auth'
import { csrfGuard } from '@/server/middleware/csrf'
import { proxyAuthMiddleware } from '@/server/middleware/proxy-auth'
import { SESSION_COOKIE_NAME } from '@/server/middleware/session-cookie'
import { authRoutes } from '@/server/routes/auth'
import type { HonoEnv } from '@/server/types'
import { createTestApp, makeDeps } from '../../helpers/test-app'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })
let db: Database
let close: () => Promise<void>
let app: ReturnType<typeof createTestApp>['app']
let deps: ReturnType<typeof createTestApp>['deps']
const cookie = { cookie: `${SESSION_COOKIE_NAME}=owner-session` }
const csrf = {
  ...cookie,
  Origin: 'http://localhost',
  'X-Digarr-CSRF': '1',
  'Content-Type': 'application/json',
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
const root = '/api/v1/auth/tokens'

beforeAll(async () => {
  const result = await makeTestDb()
  db = result.db as unknown as Database
  close = result.close
})
afterAll(async () => {
  await clearAllSessions()
  await close?.()
})
beforeEach(async () => {
  await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`)
  await db.insert(users).values([
    { id: 1, username: 'owner', passwordHash: 'hash', isAdmin: true },
    { id: 2, username: 'other', passwordHash: 'hash' },
  ])
  await clearAllSessions()
  await createSession(1, 'owner-session')
  await createSession(2, 'other-session')
  const result = createTestApp({
    db,
    getUserById: async (id) => (await db.select().from(users).where(eq(users.id, id)))[0] ?? null,
  })
  app = result.app
  deps = result.deps
})

async function mint(scope: ApiTokenScope = 'write', userId = 1) {
  return apiTokenQueries(db).create(userId, 'automation', scope, null)
}

describe('personal API tokens', () => {
  it.each(['read', 'write', 'admin'] as const)(
    'creates, lists and revokes an owner %s token with hash-only storage',
    async (scope) => {
      const res = await app.request(root, {
        method: 'POST',
        headers: csrf,
        body: JSON.stringify({ name: ' nightly ', scope, expiresInDays: 30 }),
      })
      expect(res.status).toBe(201)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const created = await res.json()
      expect(created).toMatchObject({ name: 'nightly', scope, prefix: created.token.slice(0, 8) })
      expect(created.token).toMatch(/^dga_[A-Za-z0-9_-]{43}$/)
      expect(new Date(created.expiresAt).getTime() - Date.now()).toBeCloseTo(30 * 86_400_000, -4)
      expect(created).not.toHaveProperty('tokenHash')
      const stored = await db.select().from(apiTokens)
      expect(stored[0]?.tokenHash).toBe(hashApiToken(created.token))
      expect(JSON.stringify(stored)).not.toContain(created.token)
      const listed = await app.request(root, { headers: cookie })
      expect(await listed.json()).toEqual([expect.objectContaining({ id: created.id, scope })])
      const listedAgain = await app.request(root, { headers: cookie })
      const publicList = await listedAgain.json()
      expect(publicList[0]).not.toHaveProperty('token')
      expect(publicList[0]).not.toHaveProperty('tokenHash')
      expect(
        await (
          await app.request(root, { headers: { cookie: `${SESSION_COOKIE_NAME}=other-session` } })
        ).json(),
      ).toEqual([])
      const notOwner = await app.request(`${root}/${created.id}`, {
        method: 'DELETE',
        headers: { ...csrf, cookie: `${SESSION_COOKIE_NAME}=other-session` },
      })
      expect(notOwner.status).toBe(404)
      const revoked = await app.request(`${root}/${created.id}`, {
        method: 'DELETE',
        headers: csrf,
      })
      expect(revoked.status).toBe(204)
      expect(
        (await app.request('/api/v1/auth/validate', { headers: bearer(created.token) })).status,
      ).toBe(401)
      expect(
        (await app.request(`${root}/${created.id}`, { method: 'DELETE', headers: csrf })).status,
      ).toBe(404)
    },
  )

  it.each([
    { scope: 'read', method: 'GET', path: '/api/v1/auth/validate', status: 204 },
    { scope: 'read', method: 'HEAD', path: '/api/v1/auth/validate', status: 204 },
    { scope: 'read', method: 'POST', path: '/api/v1/auth/logout', status: 403 },
    { scope: 'write', method: 'POST', path: '/api/v1/auth/logout', status: 204 },
    { scope: 'write', method: 'GET', path: '/api/v1/users', status: 403 },
    { scope: 'admin', method: 'GET', path: '/api/v1/users', status: 200 },
  ] as const)('enforces $scope scope on $method $path', async ({ scope, method, path, status }) => {
    const { token } = await mint(scope)
    expect((await app.request(path, { method, headers: bearer(token) })).status).toBe(status)
  })

  it.each(['write', 'admin'] as const)(
    'checks the current user role for %s tokens on admin and inline admin routes',
    async (scope) => {
      const { token } = await mint(scope)
      await db.update(users).set({ isAdmin: false }).where(eq(users.id, 1))
      expect((await app.request('/api/v1/users', { headers: bearer(token) })).status).toBe(403)
      const forbidden = await app.request('/api/v1/settings/test-webhook', {
        method: 'POST',
        headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(forbidden.status).toBe(403)
    },
  )

  it.each(['read', 'write'] as const)(
    'does not grant inline admin access to an admin-owned %s token',
    async (scope) => {
      const { token } = await mint(scope)
      const status = await app.request('/api/v1/pipeline/status', { headers: bearer(token) })
      expect(await status.json()).not.toHaveProperty('lastRun')
      const targets = await app.request('/api/v1/targets', { headers: bearer(token) })
      expect(targets.status).toBe(200)
      expect(deps.getLastBatch).not.toHaveBeenCalled()
      expect(deps.targetQueries.getAllTargets).not.toHaveBeenCalled()
      expect(deps.targetQueries.getTargetsByUser).toHaveBeenCalledWith(1)
    },
  )

  it.each(['read', 'write', 'admin'] as const)(
    'limits cross-user target access to admin scope for an admin-owned %s token',
    async (scope) => {
      const { createLidarrClient } = await import('@/core/clients/lidarr')
      const client = vi
        .spyOn(await import('@/core/clients/lidarr'), 'createLidarrClient')
        .mockReturnValue({
          getQualityProfiles: async () => [{ id: 1, name: 'FLAC' }],
          getMetadataProfiles: async () => [{ id: 1, name: 'Standard' }],
          getRootFolders: async () => [{ id: 1, path: '/music' }],
        } as unknown as ReturnType<typeof createLidarrClient>)
      try {
        vi.mocked(deps.targetQueries.getTarget).mockResolvedValue({
          id: 5,
          type: 'lidarr',
          userId: 2,
          name: 'other target',
          enabled: true,
          config: { url: 'http://lidarr.example', apiKey: 'key' },
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        const { token } = await mint(scope)
        const options = await app.request('/api/v1/lidarr/approve-options?targetId=5', {
          headers: bearer(token),
        })
        expect(options.status).toBe(scope === 'admin' ? 200 : 404)
        if (scope !== 'read') {
          const tested = await app.request('/api/v1/targets/5/test', {
            method: 'POST',
            headers: bearer(token),
          })
          expect(tested.status).toBe(scope === 'admin' ? 200 : 404)
          expect(deps.testTargetConnection).toHaveBeenCalledTimes(scope === 'admin' ? 1 : 0)
        }
      } finally {
        client.mockRestore()
      }
    },
  )

  it.each(['read', 'write', 'admin'] as const)(
    'allows normal per-user preference writes with %s scope',
    async (scope) => {
      const { token } = await mint(scope)
      const res = await app.request('/api/v1/auth/me/preferences', {
        method: 'PATCH',
        headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ netNewAlbumDiscovery: true }),
      })
      expect(res.status).toBe(scope === 'read' ? 403 : 204)
      const [owner] = await db.select().from(users).where(eq(users.id, 1))
      expect(owner?.preferences?.netNewAlbumDiscovery).toBe(scope === 'read' ? undefined : true)
    },
  )

  it.each(['expired', 'revoked', 'unknown', 'malformed', 'deleted-user'] as const)(
    'rejects %s credentials with the existing 401 problem',
    async (kind) => {
      const created = await mint()
      let token = created.token
      if (kind === 'expired')
        await db.update(apiTokens).set({ expiresAt: new Date(Date.now() - 1000) })
      if (kind === 'revoked') await apiTokenQueries(db).revoke(1, created.id)
      if (kind === 'unknown') token = `dga_${'x'.repeat(43)}`
      if (kind === 'malformed') token = 'dga_bad'
      if (kind === 'deleted-user') await db.delete(users).where(eq(users.id, 1))
      const res = await app.request('/api/v1/auth/validate', { headers: bearer(token) })
      expect(res.status).toBe(401)
      expect(res.headers.get('content-type')).toContain('application/problem+json')
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="digarr"')
      expect(await res.json()).toMatchObject({ type: '/problems/not-authenticated', status: 401 })
      if (kind === 'deleted-user') expect(await db.select().from(apiTokens)).toEqual([])
    },
  )

  it.each(['cookie', 'query'] as const)('never accepts a personal token via %s', async (source) => {
    const { token } = await mint()
    const res = await app.request(
      source === 'query' ? `/api/v1/preview/audio?token=${token}` : '/api/v1/auth/validate',
      { headers: source === 'cookie' ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {} },
    )
    expect(res.status).toBe(401)
  })

  it.each([
    { auth: 'token', csrfHeader: false, status: 204 },
    { auth: 'cookie', csrfHeader: false, status: 403 },
    { auth: 'cookie', csrfHeader: true, status: 204 },
  ] as const)(
    'requires CSRF for $auth with header=$csrfHeader',
    async ({ auth, csrfHeader, status }) => {
      const { token } = await mint()
      const headers = auth === 'token' ? bearer(token) : csrfHeader ? csrf : cookie
      expect((await app.request('/api/v1/auth/logout', { method: 'POST', headers })).status).toBe(
        status,
      )
    },
  )

  it.each(['GET', 'POST', 'DELETE'] as const)(
    'requires a cookie session to manage tokens with %s',
    async (method) => {
      const { token, id } = await mint('admin')
      for (const auth of [token, 'owner-session']) {
        const res = await app.request(method === 'DELETE' ? `${root}/${id}` : root, {
          method,
          headers: { ...bearer(auth), 'Content-Type': 'application/json' },
          ...(method === 'POST' ? { body: JSON.stringify({ name: 'minted', scope: 'read' }) } : {}),
        })
        expect(res.status).toBe(403)
      }
    },
  )

  it.each([
    { name: '', scope: 'read' },
    { name: 'x', scope: 'root' },
    { name: 'x', scope: 'read', expiresInDays: -1 },
    { name: 'x', scope: 'read', expiresInDays: 31 },
  ])('rejects invalid create payload %j', async (body) => {
    expect(
      (await app.request(root, { method: 'POST', headers: csrf, body: JSON.stringify(body) }))
        .status,
    ).toBe(400)
  })

  it('rejects admin scope creation by a non-admin', async () => {
    const res = await app.request(root, {
      method: 'POST',
      headers: { ...csrf, cookie: `${SESSION_COOKIE_NAME}=other-session` },
      body: JSON.stringify({ name: 'escalation', scope: 'admin' }),
    })
    expect(res.status).toBe(403)
    expect(await db.select().from(apiTokens)).toEqual([])
  })

  it.each(['legacy-token-value', `dga_${'z'.repeat(43)}`])(
    'preserves legacy bearer behavior for %s',
    async (legacyToken) => {
      const previous = envConfig.authToken
      Object.defineProperty(envConfig, 'authToken', { value: legacyToken })
      try {
        expect(
          (await app.request('/api/v1/auth/validate', { headers: bearer(legacyToken) })).status,
        ).toBe(204)
        expect((await app.request('/api/v1/users', { headers: bearer(legacyToken) })).status).toBe(
          403,
        )
        expect(
          (
            await app.request('/api/v1/auth/logout', {
              method: 'POST',
              headers: bearer(legacyToken),
            })
          ).status,
        ).toBe(204)
      } finally {
        Object.defineProperty(envConfig, 'authToken', { value: previous })
      }
    },
  )

  it('updates last-used no more than once a minute, including concurrent requests', async () => {
    const { token, id } = await mint()
    expect((await db.select().from(apiTokens))[0]?.lastUsedAt).toBeNull()
    await Promise.all(
      Array.from({ length: 4 }, () =>
        app.request('/api/v1/auth/validate', { headers: bearer(token) }),
      ),
    )
    const first = (await db.select().from(apiTokens))[0]?.lastUsedAt
    expect(first).toBeInstanceOf(Date)
    await app.request('/api/v1/auth/validate', { headers: bearer(token) })
    expect((await db.select().from(apiTokens))[0]?.lastUsedAt).toEqual(first)
    await db
      .update(apiTokens)
      .set({ lastUsedAt: new Date(Date.now() - 61_000) })
      .where(eq(apiTokens.id, id))
    await app.request('/api/v1/auth/validate', { headers: bearer(token) })
    expect((await db.select().from(apiTokens))[0]?.lastUsedAt?.getTime()).toBeGreaterThanOrEqual(
      first?.getTime() ?? 0,
    )
  })

  it('blocks exhausted socket IPs before credential lookup and resets the failure budget', async () => {
    vi.useFakeTimers()
    try {
      const resolveApiToken = vi.fn(apiTokenQueries(db).resolve)
      const guarded = new Hono<HonoEnv>()
      guarded.use(
        '*',
        authGuard({
          hasUsers: async () => true,
          isSetupComplete: async () => true,
          resolveApiToken,
        }),
      )
      guarded.get('/api/v1/test', (c) => c.json({ ok: true }))
      const { token } = await mint()
      const request = (value: string, ip = '192.0.2.1', forwarded = '198.51.100.1') =>
        guarded.request(
          '/api/v1/test',
          {
            headers: { ...bearer(value), 'X-Forwarded-For': forwarded },
          },
          { remoteAddress: ip },
        )
      for (let i = 0; i < 21; i++) expect((await request(token)).status).toBe(200)
      for (let i = 0; i < 20; i++) {
        expect((await request('dga_invalid', '192.0.2.1', `198.51.100.${i}`)).status).toBe(401)
      }
      resolveApiToken.mockClear()
      const limited = await request('dga_invalid')
      expect(limited.status).toBe(429)
      expect(limited.headers.get('Retry-After')).toBeTruthy()
      expect((await request(token)).status).toBe(429)
      expect(resolveApiToken).not.toHaveBeenCalled()
      expect((await request(token, '192.0.2.2')).status).toBe(200)
      vi.advanceTimersByTime(60_001)
      expect((await request(token)).status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps explicit token scopes behind a trusted sign-in proxy', async () => {
    const { token } = await mint('read')
    const proxyApp = new Hono<HonoEnv>()
    const getUserByUsername = vi.fn()
    const createUser = vi.fn()
    proxyApp.use(
      '*',
      proxyAuthMiddleware({
        enabled: true,
        trustedProxies: ['127.0.0.1/32'],
        getUserByUsername,
        createUser,
      }),
    )
    proxyApp.use(
      '*',
      authGuard({
        hasUsers: async () => true,
        isSetupComplete: async () => true,
        resolveApiToken: apiTokenQueries(db).resolve,
      }),
    )
    proxyApp.post('/api/v1/test', (c) => c.json({ ok: true }))
    const res = await proxyApp.request(
      '/api/v1/test',
      { method: 'POST', headers: { ...bearer(token), 'X-Forwarded-User': 'owner' } },
      { remoteAddress: '127.0.0.1' },
    )
    expect(res.status).toBe(403)
    expect(getUserByUsername).not.toHaveBeenCalled()
  })

  it.each(['none', 'owner', 'other', 'token'] as const)(
    'checks an existing same-user cookie on proxy token management: %s',
    async (kind) => {
      const proxyApp = new Hono<HonoEnv>()
      const getUserByUsername = async () =>
        (await db.select().from(users).where(eq(users.id, 1)))[0] ?? null
      const deps = makeDeps({ db, getUserByUsername })
      proxyApp.use(
        '*',
        proxyAuthMiddleware({
          enabled: true,
          trustedProxies: ['127.0.0.1/32'],
          getUserByUsername,
          createUser: vi.fn(),
        }),
      )
      proxyApp.use(
        '*',
        authGuard({
          hasUsers: async () => true,
          isSetupComplete: async () => true,
          resolveApiToken: apiTokenQueries(db).resolve,
        }),
      )
      proxyApp.use('*', csrfGuard)
      proxyApp.route('/', authRoutes(deps))
      const { token } = await mint('admin')
      const res = await proxyApp.request(
        root,
        {
          headers: {
            'X-Forwarded-User': 'owner',
            ...(kind === 'none'
              ? {}
              : {
                  cookie: `${SESSION_COOKIE_NAME}=${kind === 'other' ? 'other-session' : 'owner-session'}`,
                }),
            ...(kind === 'token' ? bearer(token) : {}),
          },
        },
        { remoteAddress: '127.0.0.1' },
      )
      expect(res.status).toBe(kind === 'owner' ? 200 : 403)
    },
  )

  it('excludes tokens from backups and allows restore to replace users and delete their tokens', async () => {
    const created = await mint('admin')
    const savedRows = await db.select().from(apiTokens)
    const backupResponse = await app.request('/api/v1/admin/backup', {
      method: 'POST',
      headers: bearer('owner-session'),
    })
    expect(backupResponse.status).toBe(200)
    const backup = await backupResponse.json()
    expect(backup.data).not.toHaveProperty('apiTokens')
    expect(JSON.stringify(backup)).not.toContain(savedRows[0]?.tokenHash)
    backup.data.apiTokens = savedRows
    const restore = () =>
      app.request('/api/v1/admin/restore?confirm=true', {
        method: 'POST',
        headers: { ...bearer('owner-session'), 'Content-Type': 'application/json' },
        body: JSON.stringify(backup),
      })
    expect((await restore()).status).toBe(200)
    expect(await db.select().from(apiTokens)).toEqual([])
    expect(
      (await app.request('/api/v1/auth/validate', { headers: bearer(created.token) })).status,
    ).toBe(401)
  })

  it('keeps tokens valid when restore leaves their user unchanged and ignores saved tokens', async () => {
    const created = await mint()
    const current = await db.select().from(apiTokens)
    const backup = await createBackup(db)
    const result = await restoreBackup(db, {
      ...backup,
      // Selective restores may omit users, leaving their credentials intact.
      data: { settings: backup.data.settings, apiTokens: [] } as BackupFile['data'],
    })
    expect(result.tablesRestored).not.toHaveProperty('apiTokens')
    expect(await db.select().from(apiTokens)).toEqual(current)
    expect((await db.select().from(users).where(eq(users.id, 1)))[0]?.username).toBe('owner')
    expect(
      (await app.request('/api/v1/auth/validate', { headers: bearer(created.token) })).status,
    ).toBe(204)
    expect((await createBackup(db)).data).not.toHaveProperty('apiTokens')
  })

  it('can rerun the generated migration without changing existing tokens', async () => {
    await mint()
    for (const statement of readFileSync('drizzle/0057_absurd_the_captain.sql', 'utf8').split(
      '--> statement-breakpoint',
    )) {
      if (statement.trim()) await db.execute(sql.raw(statement))
    }
    expect(await db.select().from(apiTokens)).toHaveLength(1)
  })
})
