// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testTargetConnection } from '@/core/targets/test-connection'

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
