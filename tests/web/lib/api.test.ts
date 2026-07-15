// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  downloadBackup,
  exportPlaylistApi,
  exportRecommendations,
  importDeezerFavorites,
  importDeezerFollowed,
  importSpotifyLikedSongs,
  setStoredToken,
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

beforeEach(() => {
  vi.restoreAllMocks()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', memoryStorage())
  setStoredToken('session-token')
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

describe('authenticated downloads', () => {
  it('sends the stored token and locale for every raw download', async () => {
    fetchMock.mockResolvedValue(successfulDownload())

    await exportRecommendations('csv', { status: 'approved', batchId: 4 })
    await exportPlaylistApi(7, 'm3u')
    await downloadBackup(true)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/exports/csv?status=approved&batchId=4',
      '/api/v1/playlists/7/export/m3u',
      '/api/v1/admin/backup?includeCaches=true',
    ])
    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      const headers = new Headers(init.headers)
      expect(headers.get('Authorization')).toBe('Bearer session-token')
      expect(headers.get('X-Digarr-Locale')).toBe('de')
    }
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBeUndefined()
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('POST')
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
  it('posts the three no-body imports and preserves their response shape', async () => {
    const responses = [
      { message: 'spotify', subscriptionId: 1, created: true },
      { message: 'favorites', subscriptionId: 2, created: false },
      { message: 'followed', subscriptionId: 3, created: true },
    ]
    for (const response of responses) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(response),
      })
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
    }
  })
})
