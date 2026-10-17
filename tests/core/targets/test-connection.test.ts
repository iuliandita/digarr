// @vitest-environment node
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testTargetConnection } from '@/core/targets/test-connection'
import { targetRoutes } from '@/server/routes/targets'
import type { HonoEnv } from '@/server/types'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function json(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

afterEach(() => {
  fetchMock.mockReset()
})

describe('testTargetConnection', () => {
  it('tests each saved playlist target with its stored credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        MediaContainer: { friendlyName: 'Plex', version: '1.0', machineIdentifier: 'machine-1' },
      }),
    )
    await expect(
      testTargetConnection('plex-playlist', {
        url: 'https://plex.test',
        token: 'plex-token',
      }),
    ).resolves.toMatchObject({ success: true })
    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).get('X-Plex-Token')).toBe('plex-token')

    fetchMock.mockResolvedValueOnce(json({ ServerName: 'Jellyfin', Version: '10.9.0' }))
    await expect(
      testTargetConnection('jellyfin-playlist', {
        url: 'https://jellyfin.test',
        apiKey: 'jellyfin-key',
        userId: 'user-1',
        skipTlsVerify: true,
      }),
    ).resolves.toMatchObject({ success: true })
    const jellyfinInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(new Headers(jellyfinInit.headers).get('X-Emby-Token')).toBe('jellyfin-key')
    expect(jellyfinInit).toMatchObject({ tls: { rejectUnauthorized: false } })

    fetchMock.mockResolvedValueOnce(
      json({ 'subsonic-response': { status: 'ok', version: '1.16.1' } }),
    )
    await expect(
      testTargetConnection('navidrome-playlist', {
        url: 'https://navidrome.test',
        username: 'listener',
        password: 'navidrome-password',
      }),
    ).resolves.toMatchObject({ success: true })
    const navidromeUrl = String(fetchMock.mock.calls[2]?.[0])
    expect(navidromeUrl).toContain('u=listener')
    expect(navidromeUrl).not.toContain('navidrome-password')
  })

  it('preserves existing target-specific connection behavior', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json([])))
    await expect(
      testTargetConnection('lidarr', {
        url: 'https://lidarr.test',
        apiKey: 'lidarr-key',
        skipTlsVerify: true,
      }),
    ).resolves.toMatchObject({ success: true })
    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).get('X-Api-Key')).toBe('lidarr-key')
    fetchMock.mockReset()

    fetchMock.mockImplementation((url: string | URL | Request) => {
      if (String(url).endsWith('/System/Info')) {
        return Promise.resolve(json({ ServerName: 'Jellyfin', Version: '10.9.0' }))
      }
      return Promise.resolve(json({ Items: [] }))
    })
    const jellyfinResult = await testTargetConnection('jellyfin', {
      url: 'https://jellyfin.test',
      apiKey: 'jellyfin-key',
      userId: 'a0b8e0d0-0000-4000-8000-000000000001',
    })
    expect(jellyfinResult).toMatchObject({ success: true, details: { artistCount: 0 } })

    fetchMock.mockReset()
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ ServerName: 'Emby', Version: '4.8.0' })),
    )
    await expect(
      testTargetConnection('emby-playlist', {
        url: 'https://emby.test',
        apiKey: 'emby-key',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ success: true })

    fetchMock.mockReset()
    fetchMock.mockImplementation(() => Promise.resolve(json({ version: '0.20.0' })))
    await expect(
      testTargetConnection('slskd', {
        url: 'https://slskd.test',
        apiKey: 'slskd-key',
      }),
    ).resolves.toMatchObject({ success: true, message: 'Connected to slskd v0.20.0' })

    await expect(testTargetConnection('spotify-playlist', {})).resolves.toEqual({
      success: false,
      message:
        'Spotify targets require OAuth connection. Use Settings > Connections to connect Spotify first.',
    })
  })

  it('returns a controlled response for unknown target types', async () => {
    await expect(testTargetConnection('unknown-target', {})).resolves.toEqual({
      success: false,
      message: 'Unknown target type: unknown-target',
    })
  })

  it.each(['plex-playlist', 'jellyfin-playlist', 'navidrome-playlist'])(
    'returns a controlled result for an incomplete saved %s config',
    async (type) => {
      await expect(testTargetConnection(type, {})).resolves.toMatchObject({ success: false })
    },
  )
})

describe('linked slskd path probe', () => {
  const config = {
    url: 'https://slskd.test',
    apiKey: 'secret',
    lidarrTargetId: 12,
    lidarrDownloadPath: '/downloads',
  }
  const linked = { url: 'https://lidarr.test', apiKey: 'lidarr-secret', skipTlsVerify: true }

  it.each([
    {
      name: 'OK',
      listing: { directories: [] },
      parent: { directories: [{ path: '/downloads/' }] },
      success: true,
      key: 'settings.slskdPathOk',
    },
    {
      name: 'missing',
      listing: { directories: [] },
      parent: { directories: [] },
      success: false,
      key: 'settings.slskdPathUnavailable',
    },
    {
      name: 'malformed',
      listing: {},
      parent: {},
      success: false,
      key: 'settings.slskdPathUnavailable',
    },
  ])('reports $name paths', async ({ listing, parent, success, key }) => {
    fetchMock
      .mockResolvedValueOnce(json({ version: '1' }))
      .mockResolvedValueOnce(json(listing))
      .mockResolvedValueOnce(json(parent))
    const result = await testTargetConnection('slskd', config, linked)
    expect(result).toMatchObject({ success, details: { messageKey: key } })
    const url = new URL(fetchMock.mock.calls[1]?.[0])
    expect(url.pathname).toBe('/api/v1/filesystem')
    expect(url.searchParams.get('path')).toBe('/downloads/')
    expect(url.searchParams.get('includeFiles')).toBe('false')
    expect(new Headers(fetchMock.mock.calls[1]?.[1].headers).get('X-Api-Key')).toBe('lidarr-secret')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ tls: { rejectUnauthorized: false } })
  })

  it.each(['/downloads/incomplete', 'C:\\downloads\\Incomplete\\artist', '/in-progress'])(
    'warns about %s',
    async (path) => {
      fetchMock.mockResolvedValueOnce(json({ version: '1' }))
      expect(
        await testTargetConnection('slskd', { ...config, lidarrDownloadPath: path }, linked),
      ).toMatchObject({ success: false, details: { messageKey: 'settings.slskdPathIncomplete' } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it.each([403, 404])('reports a path error for HTTP %s without secrets', async (status) => {
    fetchMock
      .mockResolvedValueOnce(json({ version: '1' }))
      .mockResolvedValueOnce(new Response('lidarr-secret', { status }))
    const result = await testTargetConnection('slskd', config, linked)
    expect(result).toMatchObject({
      success: false,
      details: { messageKey: 'settings.slskdPathUnavailable' },
    })
    expect(result.message).not.toContain('lidarr-secret')
  })

  it('fails closed if the linked connection is unavailable', async () => {
    fetchMock.mockResolvedValueOnce(json({ version: '1' }))
    expect(await testTargetConnection('slskd', config)).toMatchObject({
      success: false,
      details: { messageKey: 'settings.slskdPathUnavailable' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

it.each([
  { userId: 1, enabled: true, type: 'lidarr', allowed: true },
  { userId: 2, enabled: true, type: 'lidarr', allowed: false },
  { userId: 1, enabled: false, type: 'lidarr', allowed: false },
  { userId: 1, enabled: true, type: 'slskd', allowed: false },
])(
  'only resolves an enabled same-owner Lidarr connection: %j',
  async ({ userId, enabled, type, allowed }) => {
    const linkedConfig = { url: 'http://lidarr.test', apiKey: 'secret' }
    const config = { lidarrTargetId: 12, lidarrDownloadPath: '/downloads' }
    const probe = vi.fn(async () => ({ success: true, message: 'ok' }))
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      await next()
    })
    app.route(
      '/',
      targetRoutes({
        getUserById: async () => ({ isAdmin: false }),
        targetQueries: {
          getTarget: async (id: number) =>
            id === 1
              ? { id: 1, type: 'slskd', userId: 1, config }
              : { id: 12, type, userId, enabled, config: linkedConfig },
        },
        testTargetConnection: probe,
      } as never),
    )
    const response = await app.request('/api/v1/targets/1/test', { method: 'POST' })
    expect(response.status).toBe(200)
    if (allowed)
      expect(probe).toHaveBeenCalledWith('slskd', config, expect.objectContaining(linkedConfig))
    else expect(probe).toHaveBeenCalledWith('slskd', config)
  },
)
