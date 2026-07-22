// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  AUTH_EXPIRED_EVENT,
  bulkIgnoreLibraryAlbums,
  bulkIgnoreLibraryArtists,
  changePassword,
  clearStoredToken,
  downloadBackup,
  exportPlaylistApi,
  exportRecommendations,
  getCurrentUser,
  getLegacyStoredToken,
  getSettings,
  importDeezerFavorites,
  importDeezerFollowed,
  importSpotifyLikedSongs,
  loginUser,
  migrateLegacySession,
  registerUser,
  updateSettings,
} from '@/web/lib/api'
import { setStoredLocale } from '@/web/lib/locale-storage'

const fetchMock = vi.fn()
let clickedAnchor: HTMLAnchorElement | null = null

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? 'Request failed' : 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response
}

function noContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    statusText: 'No Content',
    headers: new Headers(),
  } as unknown as Response
}

function successfulDownload(filename?: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(
      filename ? { 'content-disposition': `attachment; filename="${filename}"` } : {},
    ),
    blob: vi.fn().mockResolvedValue(new Blob(['content'])),
  } as unknown as Response
}

function expectCookieRequest(init: RequestInit, csrf: boolean): Headers {
  expect(init.credentials).toBe('same-origin')
  const headers = new Headers(init.headers)
  expect(headers.has('Authorization')).toBe(false)
  expect(headers.get('X-Digarr-Locale')).toBe('de')
  expect(headers.get('X-Digarr-CSRF')).toBe(csrf ? '1' : null)
  return headers
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', memoryStorage())
  localStorage.setItem('digarr-auth-token', 'legacy-session-token')
  setStoredLocale('de')
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:test'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
  clickedAnchor = null
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clickedAnchor = this
  })
})

describe('cookie-authenticated API transport', () => {
  it('retains the legacy token only for one-time migration reads and removal', () => {
    expect(getLegacyStoredToken()).toBe('legacy-session-token')

    clearStoredToken()

    expect(localStorage.getItem('digarr-auth-token')).toBeNull()
  })

  it('treats an unavailable legacy storage read as no stored session', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError')
      }),
    })

    expect(getLegacyStoredToken()).toBeNull()
  })

  it('does not throw when legacy storage removal is unavailable', () => {
    vi.stubGlobal('localStorage', {
      removeItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError')
      }),
    })

    expect(() => clearStoredToken()).not.toThrow()
  })

  it('uses cookies without Authorization and adds CSRF only to unsafe methods', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ setupComplete: true }))
    fetchMock.mockResolvedValueOnce(noContentResponse())

    await getSettings()
    await updateSettings({ setupComplete: true })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/settings',
      '/api/v1/settings',
    ])
    const safeInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const unsafeInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expectCookieRequest(safeInit, false)
    expectCookieRequest(unsafeInit, true)
    expect(safeInit.method).toBeUndefined()
    expect(unsafeInit.method).toBe('PATCH')
  })

  it('requests cookie mode for login and registration without returning a token', async () => {
    const login = { user: { id: 1, username: 'admin', isAdmin: true } }
    const registration = { user: { id: 2, username: 'user', isAdmin: false } }
    fetchMock.mockResolvedValueOnce(jsonResponse(login))
    fetchMock.mockResolvedValueOnce(jsonResponse(registration))

    await expect(loginUser('admin', 'correct horse battery staple')).resolves.toEqual(login)
    await expect(registerUser('user', 'correct horse battery staple')).resolves.toEqual(
      registration,
    )

    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      const headers = expectCookieRequest(init, true)
      expect(headers.get('X-Digarr-Auth-Mode')).toBe('cookie')
    }
  })

  it('always resolves the current user through the cookie session', async () => {
    const profile = {
      id: 1,
      username: 'admin',
      isAdmin: true,
      preferredLocale: 'de',
      email: null,
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(profile))

    await expect(getCurrentUser()).resolves.toEqual(profile)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/me')
    expectCookieRequest(fetchMock.mock.calls[0]?.[1] as RequestInit, false)
  })

  it('treats browser password changes as void cookie rotations', async () => {
    fetchMock.mockResolvedValueOnce(noContentResponse())

    await expect(changePassword('old-password', 'new-password-123')).resolves.toBeUndefined()

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expectCookieRequest(init, true)
    expect(localStorage.getItem('digarr-auth-token')).toBe('legacy-session-token')
  })

  it('posts bulk library ignores with cookie credentials and CSRF', async () => {
    const artistItems = [{ source: 'plex', sourceArtistId: 'artist-1' }]
    const albumItems = [{ source: 'jellyfin', sourceAlbumId: 'album-1' }]
    fetchMock.mockResolvedValueOnce(noContentResponse()).mockResolvedValueOnce(noContentResponse())

    await expect(bulkIgnoreLibraryArtists(artistItems)).resolves.toBeUndefined()
    await expect(bulkIgnoreLibraryAlbums(albumItems)).resolves.toBeUndefined()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/library/overrides/bulk-ignore',
      '/api/v1/library/album-overrides/bulk-ignore',
    ])
    for (const [index, items] of [artistItems, albumItems].entries()) {
      const init = fetchMock.mock.calls[index]?.[1] as RequestInit
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ items }))
      expect(expectCookieRequest(init, true).get('Content-Type')).toBe('application/json')
    }
  })

  it('clears legacy storage and emits auth-expired on a general 401', async () => {
    const onExpired = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired, { once: true })
    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'Unauthorized' }, 401))

    await expect(getSettings()).rejects.toMatchObject({ status: 401 })

    expect(localStorage.getItem('digarr-auth-token')).toBeNull()
    expect(onExpired).toHaveBeenCalledTimes(1)
  })
})

describe('legacy session migration', () => {
  it.each([
    { status: 204, body: undefined, expected: 'migrated' },
    { status: 401, body: { title: 'Unauthorized' }, expected: 'invalid' },
    {
      status: 403,
      body: { type: '/problems/auth-session-migration-legacy-token', status: 403 },
      expected: 'legacy-rejected',
    },
  ] as const)('maps status $status to $expected', async ({ status, body, expected }) => {
    fetchMock.mockResolvedValueOnce(
      status === 204 ? noContentResponse() : jsonResponse(body, status),
    )

    await expect(migrateLegacySession('browser-bearer')).resolves.toBe(expected)

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe('Bearer browser-bearer')
    expect(headers.get('X-Digarr-CSRF')).toBe('1')
    expect(headers.get('X-Digarr-Auth-Mode')).toBe('cookie')
    expect(headers.get('X-Digarr-Locale')).toBe('de')
    expect(localStorage.getItem('digarr-auth-token')).toBe('legacy-session-token')
  })

  it('throws ApiError for non-dedicated migration failures', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ type: '/problems/auth-session-migration-requires-bearer', status: 403 }, 403),
    )

    const error = await migrateLegacySession('browser-bearer').catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403 })
  })

  it('throws ApiError when a migration failure has a null JSON body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 403))

    const error = await migrateLegacySession('browser-bearer').catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403, data: null })
  })
})

describe('authenticated downloads', () => {
  it('uses cookie credentials and protects the raw POST backup download with CSRF', async () => {
    fetchMock.mockResolvedValue(successfulDownload())

    await exportRecommendations('csv', { status: 'approved', batchId: 4 })
    await exportPlaylistApi(7, 'm3u')
    await downloadBackup(true)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/exports/csv?status=approved&batchId=4',
      '/api/v1/playlists/7/export/m3u',
      '/api/v1/admin/backup?includeCaches=true',
    ])
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    const backupInit = fetchMock.mock.calls[2]?.[1] as RequestInit
    expectCookieRequest(firstInit, false)
    expectCookieRequest(secondInit, false)
    expectCookieRequest(backupInit, true)
    expect(firstInit.method).toBeUndefined()
    expect(secondInit.method).toBeUndefined()
    expect(backupInit.method).toBe('POST')
  })

  it('uses the response filename when one is provided', async () => {
    fetchMock.mockResolvedValueOnce(successfulDownload('server-backup.json'))

    await downloadBackup()

    expect(clickedAnchor?.download).toBe('server-backup.json')
  })

  it('preserves each download function error shape', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: vi.fn().mockResolvedValue({ title: 'Backup failed' }),
      })

    await expect(exportRecommendations('json')).rejects.toThrow('Export failed')
    await expect(exportPlaylistApi(7, 'json')).rejects.toThrow('Playlist export failed')
    const backupError = await downloadBackup().catch((error: unknown) => error)
    expect(backupError).toBeInstanceOf(ApiError)
    expect(backupError).toMatchObject({
      status: 422,
      message: 'Backup failed',
    })
  })
})

describe('subscription imports', () => {
  it('posts the three no-body imports with cookie credentials and CSRF', async () => {
    const responses = [
      { message: 'spotify', subscriptionId: 1, created: true },
      { message: 'favorites', subscriptionId: 2, created: false },
      { message: 'followed', subscriptionId: 3, created: true },
    ]
    for (const response of responses) {
      fetchMock.mockResolvedValueOnce(jsonResponse(response))
    }

    await expect(importSpotifyLikedSongs()).resolves.toEqual(responses[0])
    await expect(importDeezerFavorites()).resolves.toEqual(responses[1])
    await expect(importDeezerFollowed()).resolves.toEqual(responses[2])

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/subscriptions/import/spotify-liked-songs',
      '/api/v1/subscriptions/import/deezer-favorites',
      '/api/v1/subscriptions/import/deezer-followed',
    ])
    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(init.method).toBe('POST')
      expect(init.body).toBeUndefined()
      expectCookieRequest(init, true)
    }
  })
})
