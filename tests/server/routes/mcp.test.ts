// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { envConfig } from '@/config/env'
import { clearAllSessions, createSession } from '@/core/sessions'
import type { Database } from '@/db'
import { apiTokenQueries } from '@/db/queries/api-tokens'
import {
  getRecommendation,
  listRecommendations,
  rejectRecommendation,
  updateRecommendationStatus,
} from '@/db/queries/recommendations'
import {
  type ApiTokenScope,
  artistBlocks,
  artists,
  recommendationBatches,
  recommendations,
  users,
} from '@/db/schema'
import { setMaintenance } from '@/server/maintenance'
import { SESSION_COOKIE_NAME } from '@/server/middleware/session-cookie'
import { createTestApp } from '../../helpers/test-app'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })
let db: Database
let close: () => Promise<void>
let app: ReturnType<typeof createTestApp>['app']
let deps: ReturnType<typeof createTestApp>['deps']
let token: string
const root = '/api/v1/mcp'
const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-11-25',
}

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
  await db.execute(sql`TRUNCATE users, artists, recommendation_batches RESTART IDENTITY CASCADE`)
  await db.insert(users).values([
    { id: 1, username: 'owner', passwordHash: 'hash', isAdmin: true },
    { id: 2, username: 'other', passwordHash: 'hash' },
  ])
  await db.insert(artists).values({
    id: 1,
    mbid: '00000000-0000-4000-8000-000000000001',
    name: 'Test artist',
    beginYear: 1994,
  })
  await db.insert(recommendationBatches).values({ id: 1, status: 'completed' })
  await db.insert(recommendations).values([
    {
      id: 1,
      userId: 1,
      artistId: 1,
      batchId: 1,
      score: 0.9,
      aiReasoning: 'Matches your trip-hop listening',
      sources: { similarity: 0.9 },
    },
    {
      id: 2,
      userId: 2,
      artistId: 1,
      batchId: 1,
      score: 0.8,
      aiReasoning: 'Other user private reason',
    },
  ])
  await clearAllSessions()
  await createSession(1, 'owner-session')
  const result = createTestApp({
    db,
    getUserById: async (id) => (await db.select().from(users).where(eq(users.id, id)))[0] ?? null,
    listRecommendations: vi.fn((filters) => listRecommendations(db, filters)),
    getRecommendation: vi.fn((id) => getRecommendation(db, id)),
    updateRecommendationStatus: vi.fn((id, status, extra) =>
      updateRecommendationStatus(db, id, status, extra),
    ),
    rejectRecommendation: vi.fn((params) => rejectRecommendation(db, params)),
  })
  app = result.app
  deps = result.deps
  token = await mint()
})

async function mint(scope: ApiTokenScope = 'write', userId = 1) {
  return (await apiTokenQueries(db).create(userId, 'MCP client', scope, null)).token
}

function rpc(method: string, params: Record<string, unknown> = {}, credential = token) {
  return app.request(root, {
    method: 'POST',
    headers: { ...headers, Authorization: `Bearer ${credential}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
}

async function call(name: string, args: Record<string, unknown> = {}, credential = token) {
  const response = await rpc('tools/call', { name, arguments: args }, credential)
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.error).toBeUndefined()
  return body.result
}

function data(result: { content: Array<{ type: string; text?: string }> }) {
  return JSON.parse(result.content.find((item) => item.type === 'text')?.text ?? 'null')
}

describe('MCP endpoint', () => {
  it.each(['none', 'cookie', 'session-bearer', 'query', 'legacy', 'proxy'] as const)(
    'rejects %s authentication with 401',
    async (kind) => {
      const previous = envConfig.authToken
      Object.defineProperty(envConfig, 'authToken', { value: 'legacy-secret' })
      try {
        const response = await app.request(kind === 'query' ? `${root}?token=${token}` : root, {
          method: 'POST',
          headers: {
            ...headers,
            ...(kind === 'cookie' ? { cookie: `${SESSION_COOKIE_NAME}=owner-session` } : {}),
            ...(kind === 'session-bearer' ? { Authorization: 'Bearer owner-session' } : {}),
            ...(kind === 'legacy' ? { Authorization: 'Bearer legacy-secret' } : {}),
            ...(kind === 'proxy' ? { 'X-Forwarded-User': 'owner' } : {}),
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
        expect(response.status).toBe(401)
        expect(response.headers.get('WWW-Authenticate')).toBe('Bearer realm="digarr"')
      } finally {
        Object.defineProperty(envConfig, 'authToken', { value: previous })
      }
    },
  )

  it('initializes without a server session and lists the stable tools for a read token', async () => {
    const read = await mint('read')
    const initialized = await rpc(
      'initialize',
      {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
      read,
    )
    expect(initialized.status).toBe(200)
    expect(initialized.headers.get('MCP-Session-Id')).toBeNull()
    expect((await initialized.json()).result.capabilities.tools).toBeDefined()
    const response = await rpc('tools/list', {}, read)
    expect(response.status).toBe(200)
    expect(
      (await response.json()).result.tools.map((tool: { name: string }) => tool.name).sort(),
    ).toEqual([
      'approve_recommendation',
      'block_recommendation',
      'get_job_status',
      'get_recommendation',
      'get_scan_status',
      'list_playlists',
      'list_recommendations',
      'reject_recommendation',
      'run_discovery_mode',
      'run_scan',
      'search_artists',
    ])
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/api/v1/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${read}` } },
      fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    })
    try {
      await client.connect(transport)
      expect((await client.listTools()).tools).toHaveLength(11)
      expect(
        (await client.callTool({ name: 'get_recommendation', arguments: { id: 1 } })).isError,
      ).not.toBe(true)
    } finally {
      await client.close()
    }
  })

  it.each(['GET', 'DELETE', 'malformed'] as const)(
    'preserves MCP protocol error responses for %s',
    async (method) => {
      const response = await app.request(root, {
        method: method === 'malformed' ? 'POST' : method,
        headers: { ...headers, Authorization: `Bearer ${token}` },
        ...(method === 'malformed' ? { body: '{' } : {}),
      })
      expect(response.status).toBe(method === 'malformed' ? 400 : 405)
      expect(response.headers.get('Content-Type')).toContain('application/json')
      const body = await response.json()
      expect(body).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: expect.any(Number) } })
      expect(body).not.toHaveProperty('type')
    },
  )

  it.each([
    { batch: [] },
    {
      batch: [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'run_scan', arguments: {} },
        },
      ],
    },
  ])('rejects batch arrays before any dispatch: $batch', async ({ batch }) => {
    const response = await app.request(root, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${token}` },
      body: JSON.stringify(batch),
    })
    expect(response.status).toBe(400)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600 },
    })
    expect(deps.orchestrator.enqueue).not.toHaveBeenCalled()
  })

  it.each(['declared', 'missing', 'lying', 'multibyte'] as const)(
    'rejects oversized bodies with %s Content-Length',
    async (kind) => {
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        padding: (kind === 'multibyte' ? 'é' : 'x').repeat(1024 * 1024),
      })
      const bytes = new TextEncoder().encode(payload)
      let offset = 0
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === bytes.length) return controller.close()
          const end = Math.min(offset + 16384, bytes.length)
          controller.enqueue(bytes.slice(offset, end))
          offset = end
        },
      })
      const request = new Request(`http://localhost${root}`, {
        method: 'POST',
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`,
          ...(kind === 'declared'
            ? { 'Content-Length': String(bytes.length) }
            : kind === 'lying'
              ? { 'Content-Length': '1' }
              : {}),
        },
        body: stream,
        duplex: 'half',
      } as RequestInit)
      const response = await app.fetch(request)
      expect(response.status).toBe(413)
      expect(await response.json()).toMatchObject({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000 },
      })
      expect(deps.listRecommendations).not.toHaveBeenCalled()
    },
  )

  it('rejects a declared oversized length before reading even a small body', async () => {
    const response = await app.request(root, {
      method: 'POST',
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`,
        'Content-Length': String(1024 * 1024 + 1),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(response.status).toBe(413)
  })

  it('keeps early setup and maintenance failures as problem details', async () => {
    vi.mocked(deps.isSetupComplete).mockResolvedValue(false)
    const setup = await rpc('tools/list')
    expect(setup.status).toBe(403)
    expect(setup.headers.get('Content-Type')).toContain('application/problem+json')
    expect(await setup.json()).toMatchObject({ status: 403, detail: 'Setup not complete' })
    vi.mocked(deps.isSetupComplete).mockResolvedValue(true)
    setMaintenance(true)
    try {
      const maintenance = await rpc('tools/list')
      expect(maintenance.status).toBe(503)
      expect(maintenance.headers.get('Content-Type')).toContain('application/problem+json')
      expect(await maintenance.json()).toMatchObject({ status: 503, type: '/problems/maintenance' })
    } finally {
      setMaintenance(false)
    }
  })

  it('rejects DELETE for a read-scope token before protocol handling', async () => {
    const response = await app.request(root, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await mint('read')}` },
    })
    expect(response.status).toBe(403)
    expect(response.headers.get('Content-Type')).toContain('application/problem+json')
  })

  it.each([
    {
      rawUserSettings: Object.fromEntries(
        Array.from({ length: 65 }, (_, i) => [`setting${i}`, true]),
      ),
    },
    { normalizedSettings: { ['x'.repeat(65)]: true } },
    { rawUserSettings: { value: 'x'.repeat(16384) } },
  ])('bounds discovery settings', async (settings) => {
    expect(
      (await call('run_discovery_mode', { modeId: 'artist_radio', ...settings })).isError,
    ).toBe(true)
    expect(deps.runDiscoveryMode).not.toHaveBeenCalled()
  })

  it('gives fixed validation hints without echoing supplied inputs', async () => {
    const rejected = await call('reject_recommendation', {
      id: 1,
      reason: 'wrong_style',
      reasonText: 'private-input',
    })
    expect(rejected).toMatchObject({
      isError: true,
      content: [{ text: 'reasonText is only allowed when reason is other' }],
    })
    expect(deps.rejectRecommendation).not.toHaveBeenCalled()
    const invalidStatus = await call('list_recommendations', { status: 'private-input' })
    expect(invalidStatus).toMatchObject({
      isError: true,
      content: [{ text: 'Use a valid recommendation status or comma-separated list of statuses' }],
    })
    expect(JSON.stringify([rejected, invalidStatus])).not.toContain('private-input')
    expect(deps.listRecommendations).not.toHaveBeenCalled()
  })

  it('isolates concurrent dispatch contexts for different users', async () => {
    await Promise.all([call('run_scan'), call('run_scan', {}, await mint('write', 2))])
    expect(deps.orchestrator.enqueue).toHaveBeenCalledWith(expect.objectContaining({ userId: 1 }))
    expect(deps.orchestrator.enqueue).toHaveBeenCalledWith(expect.objectContaining({ userId: 2 }))
  })

  it('returns only the token owner recommendations and includes their explanation', async () => {
    const read = await mint('read')
    const result = await call('list_recommendations', { status: 'pending', limit: 10 }, read)
    expect(result.isError).not.toBe(true)
    expect(JSON.stringify(result)).toContain('Matches your trip-hop listening')
    expect(JSON.stringify(result)).not.toContain('Other user private reason')
    expect(deps.listRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, status: 'pending', limit: 10 }),
    )
    const own = await call('get_recommendation', { id: 1 }, read)
    expect(JSON.stringify(own)).toContain('Matches your trip-hop listening')
    const other = await call('get_recommendation', { id: 2 }, read)
    expect(other.isError).toBe(true)
    expect(JSON.stringify(other)).not.toContain('Other user private reason')
  })

  it('never accepts proxy identity or unauthenticated first-run access', async () => {
    const previousEnabled = envConfig.proxyAuthEnabled
    const previousProxies = envConfig.proxyAuthTrustedProxies
    Object.defineProperty(envConfig, 'proxyAuthEnabled', { value: true })
    Object.defineProperty(envConfig, 'proxyAuthTrustedProxies', { value: '127.0.0.1/32' })
    try {
      const isolated = createTestApp({
        getUserCount: async () => 0,
        isSetupComplete: async () => false,
      })
      const response = await isolated.app.request(
        root,
        {
          method: 'POST',
          headers: { ...headers, 'X-Forwarded-User': 'owner' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        },
        { remoteAddress: '127.0.0.1' },
      )
      expect(response.status).toBe(401)
      expect(isolated.deps.getUserByUsername).not.toHaveBeenCalled()
      expect(isolated.deps.createUser).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(envConfig, 'proxyAuthEnabled', { value: previousEnabled })
      Object.defineProperty(envConfig, 'proxyAuthTrustedProxies', { value: previousProxies })
    }
  })

  it.each([
    ['approve_recommendation', { id: 1 }],
    ['reject_recommendation', { id: 1 }],
    ['block_recommendation', { id: 1 }],
    ['run_scan', {}],
    ['run_discovery_mode', { modeId: 'artist_radio' }],
  ] as const)('denies %s for a read token before any mutation', async (name, args) => {
    const result = await call(name, args, await mint('read'))
    expect(result.isError).toBe(true)
    expect(deps.updateRecommendationStatus).not.toHaveBeenCalled()
    expect(deps.rejectRecommendation).not.toHaveBeenCalled()
    expect(deps.orchestrator.enqueue).not.toHaveBeenCalled()
    expect(deps.runDiscoveryMode).not.toHaveBeenCalled()
    expect((await getRecommendation(db, 1))?.status).toBe('pending')
  })

  it.each([true, false])(
    'shares the REST approval and persistence path with target success=%s',
    async (success) => {
      const addArtist = vi.fn(async () => ({
        success,
        ...(success ? { externalId: 42 } : { error: 'private-target-secret' }),
      }))
      vi.mocked(deps.getEnabledTargetsForUser).mockResolvedValue([
        { id: 'lidarr-1', name: 'Music', type: 'lidarr', capabilities: ['addArtist'], addArtist },
      ] as unknown as Awaited<ReturnType<typeof deps.getEnabledTargetsForUser>>)
      const rest = await app.request('/api/v1/recommendations/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'approved' }),
      })
      expect(rest.status).toBe(200)
      const restTarget = addArtist.mock.calls[0]
      const restUpdate = vi.mocked(deps.updateRecommendationStatus).mock.calls[0]
      expect(restTarget).toBeDefined()
      await updateRecommendationStatus(db, 1, 'pending', { targetActions: {} })
      addArtist.mockClear()
      vi.mocked(deps.updateRecommendationStatus).mockClear()
      const result = await call('approve_recommendation', { id: 1 })
      expect(result.isError === true).toBe(!success)
      expect(JSON.stringify(result)).not.toContain('private-target-secret')
      expect(addArtist.mock.calls[0]).toEqual(restTarget)
      expect(vi.mocked(deps.updateRecommendationStatus).mock.calls[0]).toEqual(restUpdate)
      expect((await getRecommendation(db, 1))?.status).toBe((await rest.json()).status)
    },
  )

  it('shares rejection and permanent blocking with the existing owner-scoped query', async () => {
    expect(
      (await call('reject_recommendation', { id: 1, reason: 'wrong_style' })).isError,
    ).not.toBe(true)
    expect((await getRecommendation(db, 1))?.rejectionReason).toBe('wrong_style')
    expect(
      (await call('block_recommendation', { id: 1, reason: 'not_interested' })).isError,
    ).not.toBe(true)
    expect(await db.select().from(artistBlocks)).toMatchObject([{ userId: 1, artistId: 1 }])
    expect((await call('block_recommendation', { id: 2 })).isError).toBe(true)
    expect((await getRecommendation(db, 2))?.status).toBe('pending')
  })

  it('limits only MCP scans per user across tokens and IPs, leaving REST scans unrestricted', async () => {
    for (let i = 0; i < 7; i++) {
      const response = await app.request('/api/v1/pipeline/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(response.status).toBe(202)
      expect(response.headers.get('X-RateLimit-Limit')).not.toBe('5')
    }
    for (let i = 0; i < 5; i++) expect((await call('run_scan')).isError).not.toBe(true)
    const response = await app.request(
      root,
      {
        method: 'POST',
        headers: { ...headers, Authorization: `Bearer ${await mint()}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'run_scan', arguments: {} },
        }),
      },
      { remoteAddress: '192.0.2.5' },
    )
    expect((await response.json()).result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Too many requests' }],
    })
    expect(deps.orchestrator.enqueue).toHaveBeenCalledTimes(12)
    expect((await call('run_scan', {}, await mint('write', 2))).isError).not.toBe(true)
    expect(deps.orchestrator.enqueue).toHaveBeenCalledTimes(13)
    expect(
      (
        await app.request('/api/v1/pipeline/run', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(202)
  })

  it('limits MCP discovery dispatch without limiting REST discovery requests', async () => {
    for (let i = 0; i < 5; i++) await call('run_discovery_mode', { modeId: 'unknown-mode' })
    expect(JSON.stringify(await call('run_discovery_mode', { modeId: 'unknown-mode' }))).toContain(
      'Too many requests',
    )
    for (let i = 0; i < 7; i++) {
      const response = await app.request('/api/v1/discovery-modes/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ modeId: 'unknown-mode' }),
      })
      expect(response.status).toBe(400)
      expect(response.headers.get('X-RateLimit-Limit')).not.toBe('5')
    }
  })

  it('keeps scan status behind the shared admin policy and returns safe own-job status', async () => {
    Object.assign(deps.orchestrator, { isRunning: true, currentUserId: 2, stage: 'scoring' })
    const read = await mint('read')
    expect(data(await call('get_scan_status', {}, read))).toMatchObject({
      running: false,
      stage: null,
    })
    expect(data(await call('get_scan_status', {}, await mint('admin')))).toMatchObject({
      running: true,
      stage: 'scoring',
    })
    vi.mocked(deps.jobQueries.getJobById).mockResolvedValue({
      id: 5,
      type: 'quick_discover',
      status: 'failed',
      userId: 1,
      startedAt: new Date(),
      completedAt: null,
      durationMs: null,
      batchId: null,
      subscriptionId: null,
      error: 'private-provider-secret',
      metadata: {},
      sourceResults: { source: { status: 'error', error: 'private-provider-secret' } },
    })
    const own = await call('get_job_status', { id: 5 }, read)
    expect(data(own)).toMatchObject({ id: 5, status: 'failed' })
    expect(JSON.stringify(own)).not.toContain('private-provider-secret')
    expect((await call('get_job_status', { id: 5 }, await mint('read', 2))).isError).toBe(true)
  })

  it('shares the failed-token budget and rejects browser origins outside the configured origin', async () => {
    for (let i = 0; i < 20; i++) {
      const response = await app.request('/api/v1/auth/validate', {
        headers: { Authorization: 'Bearer dga_invalid' },
      })
      expect(response.status).toBe(401)
    }
    const exhausted = await rpc('tools/list', {}, 'dga_invalid')
    expect(exhausted.status).toBe(429)
    expect(exhausted.headers.get('Retry-After')).toBeTruthy()
    const foreignOrigin = await app.request(
      root,
      {
        method: 'POST',
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`,
          Origin: 'https://foreign.example',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      },
      { remoteAddress: '192.0.2.2' },
    )
    expect(foreignOrigin.status).toBe(403)
  })

  it('rejects invalid input and hides service exception messages', async () => {
    expect((await call('get_recommendation', { id: -1 })).isError).toBe(true)
    expect(deps.getRecommendation).not.toHaveBeenCalled()
    vi.mocked(deps.listRecommendations).mockRejectedValue(
      new Error('Authorization: Bearer hidden-service-secret'),
    )
    const failed = await call('list_recommendations')
    expect(failed.isError).toBe(true)
    expect(JSON.stringify(failed)).not.toContain('hidden-service-secret')
  })
})
