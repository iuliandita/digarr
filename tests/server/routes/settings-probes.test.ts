// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '@/core/sessions'
import type { SettingsRow } from '@/db/queries/settings'
import { createTestApp } from '../../helpers/test-app'

const { mockCreateLidarrClient, mockGetUserConnections } = vi.hoisted(() => ({
  mockCreateLidarrClient: vi.fn(() => ({
    testConnection: vi.fn(async () => ({ success: true, message: 'Connected' })),
  })),
  mockGetUserConnections: vi.fn(async () => null),
}))

vi.mock('@/core/clients/lidarr', () => ({ createLidarrClient: mockCreateLidarrClient }))
vi.mock('@/db/queries/users', async () => ({
  ...(await vi.importActual<typeof import('@/db/queries/users')>('@/db/queries/users')),
  getUserConnections: mockGetUserConnections,
}))

const token = 'settings-probes-session'
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

beforeEach(async () => {
  vi.clearAllMocks()
  await createSession(1, token)
})

describe('settings connection probe input', () => {
  it.each([
    { saved: true, body: {}, expected: true },
    { saved: true, body: { skipTlsVerify: false }, expected: false },
    { saved: false, body: { skipTlsVerify: true }, expected: true },
    { saved: undefined, body: {}, expected: false },
  ])(
    'uses saved TLS settings with explicit overrides: $expected',
    async ({ saved, body, expected }) => {
      const { app } = createTestApp({
        getSettings: vi.fn(
          async () =>
            ({
              lidarrUrl: 'https://lidarr.example:8686',
              lidarrApiKey: 'saved-key',
              skipTlsVerify: saved,
            }) as SettingsRow,
        ),
      })
      const res = await app.request('/api/v1/settings/test/lidarr', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(200)
      expect(mockCreateLidarrClient).toHaveBeenCalledWith(
        'https://lidarr.example:8686',
        'saved-key',
        expected,
      )
    },
  )

  it.each([
    { label: 'missing', body: undefined },
    { label: 'empty', body: '' },
    { label: 'malformed', body: '{' },
    { label: 'null', body: 'null' },
    { label: 'array', body: '[]' },
    { label: 'string', body: '"value"' },
    { label: 'number', body: '1' },
    { label: 'boolean', body: 'true' },
  ])('rejects $label bodies before reading saved connections', async ({ body }) => {
    const { app, deps } = createTestApp()
    for (const service of ['lidarr', 'plex', 'ai']) {
      const res = await app.request(`/api/v1/settings/test/${service}`, {
        method: 'POST',
        headers,
        body,
      })
      expect(res.status).toBe(400)
      expect(res.headers.get('Content-Type')).toBe('application/problem+json')
      expect(await res.json()).toMatchObject({ type: '/problems/probe-invalid-input', status: 400 })
    }
    expect(deps.getSettings).not.toHaveBeenCalled()
    expect(mockGetUserConnections).not.toHaveBeenCalled()
    expect(mockCreateLidarrClient).not.toHaveBeenCalled()
    expect(deps.providerRegistry.create).not.toHaveBeenCalled()
  })

  it.each([null, 'false', 0, {}, []])(
    'rejects nonboolean Lidarr TLS flags: %j',
    async (skipTlsVerify) => {
      const { app, deps } = createTestApp()
      const res = await app.request('/api/v1/settings/test/lidarr', {
        method: 'POST',
        headers,
        body: JSON.stringify({ skipTlsVerify }),
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ type: '/problems/probe-invalid-input', status: 400 })
      expect(deps.getSettings).not.toHaveBeenCalled()
      expect(mockGetUserConnections).not.toHaveBeenCalled()
      expect(mockCreateLidarrClient).not.toHaveBeenCalled()
    },
  )

  it('keeps admin rejection ahead of body validation', async () => {
    const { app, deps } = createTestApp({
      getUserById: vi.fn(async () => ({ id: 1, isAdmin: false })) as never,
    })
    const res = await app.request('/api/v1/settings/test/lidarr', { method: 'POST', headers })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ type: '/problems/admin-required' })
    expect(deps.getSettings).not.toHaveBeenCalled()
    expect(mockCreateLidarrClient).not.toHaveBeenCalled()
  })
})

describe('media server destination policy', () => {
  const nonAdmin = () =>
    createTestApp({ getUserById: vi.fn(async () => ({ id: 1, isAdmin: false })) as never })

  it.each(['http://127.0.0.1:32400/private?q=', 'http://169.254.169.254/latest?q='])(
    'rejects a non-admin Plex probe to %s without any request',
    async (url) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const { app } = nonAdmin()
      const res = await app.request('/api/v1/settings/test/plex', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url, token: 't' }),
      })
      vi.unstubAllGlobals()
      expect(res.status).toBe(502)
      expect((await res.json()).detail).toBe('URL points to a private/internal address')
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('does not reflect upstream bodies to a non-admin Plex probe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('INTERNAL-MARKER', { status: 200 })),
    )
    const { app } = nonAdmin()
    const res = await app.request('/api/v1/settings/test/plex', {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'http://10.0.0.5:32400/status?q=', token: 't' }),
    })
    vi.unstubAllGlobals()
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.detail).toBe('Could not connect to a Plex server at this URL')
    expect(JSON.stringify(body)).not.toContain('INTERNAL-MARKER')
  })

  it.each([
    ['plexUrl', 'http://169.254.169.254/'],
    ['jellyfinUrl', 'http://localhost:8096'],
    ['embyUrl', 'file:///etc/passwd'],
    ['subsonicUrl', 'http://[::1]:4533'],
  ])('rejects a blocked %s on save', async (field, url) => {
    const { app } = nonAdmin()
    const res = await app.request('/api/v1/settings', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ [field]: url }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ type: '/problems/invalid-media-server-url' })
  })
})
