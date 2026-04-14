// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'
import { createTestApp } from '../../helpers/test-app'

const adminUser = {
  id: 1,
  username: 'admin',
  isAdmin: true,
  preferences: null,
  email: null,
  oidcSubject: null,
  authProvider: 'local' as const,
  listenbrainzUsername: null,
  listenbrainzToken: null,
  lastfmUsername: null,
  lastfmApiKey: null,
  plexUrl: null,
  plexToken: null,
  jellyfinUrl: null,
  jellyfinApiKey: null,
  jellyfinUserId: null,
  embyUrl: null,
  embyApiKey: null,
  embyUserId: null,
  discogsToken: null,
  discogsUsername: null,
  createdAt: new Date(),
}

async function authedApp() {
  const { app, deps } = createTestApp({
    getUserById: vi.fn(async (id: number) => (id === 1 ? adminUser : null)),
    getUserCount: vi.fn(async () => 1),
    getUserByUsername: vi.fn(async () => null),
  })
  await clearAllSessions()
  const token = 'test-session-token'
  await createSession(adminUser.id, token)
  return { app, deps, headers: { Authorization: `Bearer ${token}` } }
}

beforeEach(async () => {
  await clearAllSessions()
})

describe('validation: shared error shape', () => {
  it('returns error summary + code + details for a validation failure', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ username: 'a', password: 'short' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
    expect(typeof body.error).toBe('string')
    expect(Array.isArray(body.details)).toBe(true)
    expect(body.details.length).toBeGreaterThan(0)
    expect(body.details[0]).toHaveProperty('path')
    expect(body.details[0]).toHaveProperty('code')
    expect(body.details[0]).toHaveProperty('message')
  })
})

describe('validation: auth.register', () => {
  it('rejects missing username', async () => {
    const { app } = await authedApp()
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'password123' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
    expect(body.details.some((d: { path: string[] }) => d.path.includes('username'))).toBe(true)
  })

  it('rejects password shorter than 8 characters', async () => {
    const { app } = await authedApp()
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: '1234567' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
    expect(body.details.some((d: { path: string[] }) => d.path.includes('password'))).toBe(true)
  })

  it('rejects username with wrong type', async () => {
    const { app } = await authedApp()
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 42, password: 'password123' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('validation: users', () => {
  it('rejects POST /api/users with non-boolean isAdmin', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ username: 'newuser', password: 'password123', isAdmin: 'yes' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
  })

  it('rejects PATCH /api/users/:id with unknown field', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/users/2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ isAdmin: true, passwordHash: 'injected' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects PATCH /api/users/:id with non-numeric id param', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/users/not-a-number', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ isAdmin: true }),
    })
    expect(res.status).toBe(400)
  })
})

describe('validation: targets', () => {
  it('rejects POST /api/targets with invalid target type', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ type: 'made-up-type', name: 'x', config: {} }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
  })

  it('rejects POST /api/targets with non-http URL in config', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        type: 'lidarr',
        name: 'x',
        config: { url: 'ftp://evil.example' },
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects POST /api/targets with empty name', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ type: 'lidarr', name: '', config: {} }),
    })
    expect(res.status).toBe(400)
  })
})

describe('validation: settings PATCH', () => {
  it('rejects librarySyncIntervalHours out of range', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ librarySyncIntervalHours: 99 }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
  })

  it('rejects skipTlsVerify with wrong type', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ skipTlsVerify: 'true' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects scoringWeights.consensus out of [0, 1]', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        preferences: { scoringWeights: { consensus: 2.5 } },
      }),
    })
    expect(res.status).toBe(400)
  })
})

describe('validation: admin restore', () => {
  it('rejects POST /api/admin/restore with missing data section', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/admin/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        version: 1,
        appVersion: '0.27.9',
        createdAt: '2026-04-14',
        encryptionKeyHash: null,
        includesCaches: false,
        // data: {} missing entirely
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
  })

  it('rejects POST /api/admin/restore when a table is not an array', async () => {
    const { app, headers } = await authedApp()
    const res = await app.request('/api/admin/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        version: 1,
        appVersion: '0.27.9',
        createdAt: '2026-04-14',
        encryptionKeyHash: null,
        includesCaches: false,
        data: {
          settings: 'not-an-array',
          users: [],
          oauthTokens: [],
          oidcTokens: [],
          targets: [],
          subscriptions: [],
          jobRuns: [],
          recommendationBatches: [],
          recommendations: [],
          playlists: [],
          playlistTracks: [],
        },
      }),
    })
    expect(res.status).toBe(400)
  })
})
