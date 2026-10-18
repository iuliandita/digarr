// @vitest-environment node

import { EventEmitter } from 'node:events'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'
import type { DestinationTarget } from '@/core/targets/types'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'
import { recommendationRoutes } from '@/server/routes/recommendations'
import type { HonoEnv } from '@/server/types'

const artistMbid = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const other = '33333333-3333-4333-8333-333333333333'
const path = '/api/v1/recommendations/missing-albums'

function target(id: string, addAlbum = vi.fn().mockResolvedValue({ success: true })) {
  return {
    id,
    name: id,
    type: 'lidarr',
    capabilities: ['addAlbum'],
    addAlbum,
    testConnection: vi.fn(),
  } satisfies DestinationTarget
}

function makeApp(overrides: Partial<AppDependencies> = {}) {
  const deps = {
    orchestrator: new EventEmitter(),
    isSetupComplete: vi.fn(async () => true),
    getUserCount: vi.fn(async () => 1),
    getUserById: vi.fn(async () => ({ id: 7, isAdmin: false })),
    getSettings: vi.fn(async () => ({})),
    getArtistById: vi.fn(async () => ({ id: 10, mbid: artistMbid, name: 'Artist' })),
    getEnabledTargetsForUser: vi.fn(async () => [target('lidarr-1')]),
    albumCoverage: {
      getCoverageForArtist: vi.fn(async () => ({
        artistMbid,
        ownedCount: 0,
        totalCount: 2,
        owned: [],
        missing: [first, second].map((albumMbid) => ({
          albumMbid,
          title: albumMbid,
          releaseYear: null,
        })),
      })),
    },
    ...overrides,
  } as unknown as AppDependencies
  return { app: createApp(deps), deps }
}

async function post(
  app: ReturnType<typeof createApp>,
  body: unknown = { artistId: 10, albumMbids: [first, second] },
) {
  await createSession(7, 'missing-albums-session')
  return app.request(path, {
    method: 'POST',
    headers: { Authorization: 'Bearer missing-albums-session', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

afterEach(async () => {
  await clearAllSessions()
  vi.restoreAllMocks()
})

describe('POST /api/v1/recommendations/missing-albums', () => {
  it('allows non-admin sessions, checks their coverage, and uses album approval defaults', async () => {
    const albumTarget = target('lidarr-1')
    const artistTarget = {
      ...target('artist-only'),
      capabilities: ['addArtist'],
    } satisfies DestinationTarget
    const { app, deps } = makeApp({
      getEnabledTargetsForUser: vi.fn(async () => [albumTarget, artistTarget]),
    })
    const res = await post(app)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      succeeded: 2,
      failed: 0,
      results: [
        { albumMbid: first, success: true },
        { albumMbid: second, success: true },
      ],
    })
    expect(deps.albumCoverage?.getCoverageForArtist).toHaveBeenCalledWith(7, artistMbid)
    expect(deps.getEnabledTargetsForUser).toHaveBeenCalledWith(7)
    expect(deps.getArtistById).toHaveBeenCalledWith(10)
    expect(albumTarget.addAlbum).toHaveBeenCalledWith(
      { artistMbid, artistName: 'Artist', releaseGroupMbid: first },
      {
        lidarrOptionsTargetId: 'lidarr-1',
        qualityProfileId: undefined,
        metadataProfileId: undefined,
        rootFolderId: undefined,
        tags: undefined,
        userId: 7,
        recommendationId: undefined,
      },
    )
    expect(artistTarget.addAlbum).not.toHaveBeenCalled()
  })

  it('reports partial failures, redacts errors, and continues after a target throws', async () => {
    const firstTarget = target('lidarr-1')
    const failing = target(
      'lidarr-2',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('upstream apiKey=private-value'))
        .mockResolvedValueOnce({ success: false, error: 'token=another-secret' }),
    )
    const { app } = makeApp({ getEnabledTargetsForUser: vi.fn(async () => [firstTarget, failing]) })
    const res = await post(app)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      succeeded: 0,
      failed: 2,
      results: [
        {
          success: false,
          targetActions: {
            'lidarr-1': { status: 'added' },
            'lidarr-2': { status: 'failed', error: 'upstream apiKey=[redacted]' },
          },
        },
        {
          success: false,
          targetActions: {
            'lidarr-1': { status: 'added' },
            'lidarr-2': { status: 'failed', error: 'token=[redacted]' },
          },
        },
      ],
    })
    expect(firstTarget.addAlbum).toHaveBeenCalledTimes(2)
    expect(failing.addAlbum).toHaveBeenCalledTimes(2)
  })

  it('reports a temporary Lidarr failure as failed, since nothing retries batch adds', async () => {
    const albumTarget = target(
      'lidarr-1',
      vi.fn().mockResolvedValue({ success: false, error: 'HTTP 503: unavailable' }),
    )
    const { app } = makeApp({ getEnabledTargetsForUser: vi.fn(async () => [albumTarget]) })
    const body = await (await post(app, { artistId: 10, albumMbids: [first] })).json()
    expect(body).toMatchObject({
      succeeded: 0,
      failed: 1,
      results: [
        { targetActions: { 'lidarr-1': { status: 'failed', error: 'HTTP 503: unavailable' } } },
      ],
    })
    expect(body.results[0].targetActions['lidarr-1'].retry).toBeUndefined()
  })

  it('counts successful and failed albums independently', async () => {
    const albumTarget = target(
      'lidarr-1',
      vi.fn().mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true }),
    )
    const { app } = makeApp({ getEnabledTargetsForUser: vi.fn(async () => [albumTarget]) })
    const res = await post(app)
    expect(await res.json()).toMatchObject({
      succeeded: 1,
      failed: 1,
      results: [
        { albumMbid: first, success: false },
        { albumMbid: second, success: true },
      ],
    })
  })

  it('rejects a selection outside the current user missing albums before executing targets', async () => {
    const { app, deps } = makeApp()
    const res = await post(app, { artistId: 10, albumMbids: [first, other] })
    expect(res.status).toBe(400)
    expect(deps.getEnabledTargetsForUser).not.toHaveBeenCalled()
  })

  it('returns an explicit error when no enabled target supports albums', async () => {
    const { app } = makeApp({ getEnabledTargetsForUser: vi.fn(async () => []) })
    const res = await post(app)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ type: '/problems/no-album-targets' })
  })

  it('deduplicates selected album IDs before sending them', async () => {
    const albumTarget = target('lidarr-1')
    const { app } = makeApp({ getEnabledTargetsForUser: vi.fn(async () => [albumTarget]) })
    const res = await post(app, { artistId: 10, albumMbids: [first, first] })
    expect(await res.json()).toMatchObject({ succeeded: 1, failed: 0 })
    expect(albumTarget.addAlbum).toHaveBeenCalledTimes(1)
  })

  it('approves a complete selection with more than one catalog page of missing albums', async () => {
    const albumMbids = Array.from(
      { length: 101 },
      (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    )
    const albumTarget = target('lidarr-1')
    const { app } = makeApp({
      getEnabledTargetsForUser: vi.fn(async () => [albumTarget]),
      albumCoverage: {
        getCoverageForArtist: vi.fn(async () => ({
          artistMbid,
          ownedCount: 0,
          totalCount: albumMbids.length,
          owned: [],
          missing: albumMbids.map((albumMbid) => ({
            albumMbid,
            title: albumMbid,
            releaseYear: null,
          })),
        })),
      },
    })
    const res = await post(app, { artistId: 10, albumMbids })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ succeeded: 101, failed: 0 })
    expect(albumTarget.addAlbum).toHaveBeenCalledTimes(101)
  })

  it('continues with the next album when approval orchestration throws', async () => {
    const albumTarget = target('lidarr-1')
    const { app } = makeApp({
      getEnabledTargetsForUser: vi.fn(async () => [albumTarget]),
      jobRecorder: {
        start: vi.fn().mockRejectedValueOnce(new Error('token=private-value')).mockResolvedValue(1),
        complete: vi.fn(),
      } as unknown as AppDependencies['jobRecorder'],
    })
    const res = await post(app)
    expect(await res.json()).toMatchObject({
      succeeded: 1,
      failed: 1,
      results: [
        {
          albumMbid: first,
          success: false,
          targetActions: { batch: { error: 'token=[redacted]' } },
        },
        { albumMbid: second, success: true },
      ],
    })
    expect(albumTarget.addAlbum).toHaveBeenCalledTimes(1)
  })

  it('reports an album-capable target without an addAlbum implementation as failed', async () => {
    const { app } = makeApp({
      getEnabledTargetsForUser: vi.fn(async () => [{ ...target('lidarr-1'), addAlbum: undefined }]),
    })
    const res = await post(app, { artistId: 10, albumMbids: [first] })
    expect(await res.json()).toMatchObject({
      succeeded: 0,
      failed: 1,
      results: [{ success: false, targetActions: { 'lidarr-1': { status: 'failed' } } }],
    })
  })

  it('rejects legacy authentication before accessing user data', async () => {
    const { deps } = makeApp()
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      c.set('legacyTokenAuth', true)
      return next()
    })
    app.route('/', recommendationRoutes(deps))
    const res = await post(app)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ type: '/problems/session-auth-required' })
    expect(deps.getArtistById).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown artist without requesting coverage', async () => {
    const { app, deps } = makeApp({ getArtistById: vi.fn(async () => null) })
    expect((await post(app)).status).toBe(404)
    expect(deps.albumCoverage?.getCoverageForArtist).not.toHaveBeenCalled()
  })

  it.each([
    { artistId: 0, albumMbids: [first] },
    { artistId: 1.5, albumMbids: [first] },
    { artistId: 10, albumMbids: [] },
    { artistId: 10, albumMbids: ['invalid'] },
    { artistId: 10, albumMbids: Array(10_001).fill(first) },
  ])('rejects malformed payload case %#', async (body) => {
    const { app, deps } = makeApp()
    expect((await post(app, body)).status).toBe(400)
    expect(deps.getArtistById).not.toHaveBeenCalled()
  })

  it('requires authentication', async () => {
    const { app, deps } = makeApp()
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistId: 10, albumMbids: [first] }),
    })
    expect(res.status).toBe(401)
    expect(deps.getArtistById).not.toHaveBeenCalled()
  })

  it('fails closed when album coverage fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app, deps } = makeApp({
      albumCoverage: { getCoverageForArtist: vi.fn().mockRejectedValue(new Error('token=secret')) },
    })
    const res = await post(app)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
    expect(deps.getEnabledTargetsForUser).not.toHaveBeenCalled()
  })
})
