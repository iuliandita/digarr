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
