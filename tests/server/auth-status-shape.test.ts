// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'

// Registration closed by default; override so future tests that register don't blow up.
vi.mock('@/config/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/config/env')>()
  return {
    ...original,
    envConfig: { ...original.envConfig, disableRegistration: false },
  }
})

import type { AppDependencies } from '@/server'
import { createApp } from '@/server'
import { makeDeps as makeSharedDeps } from '../helpers/test-app'

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return makeSharedDeps({
    storeDb: {} as unknown as AppDependencies['storeDb'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    getSettings: vi.fn(async () => null),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 0),
    ...overrides,
  })
}

beforeEach(async () => {
  await clearAllSessions()
})

afterEach(async () => {
  await clearAllSessions()
})

describe('GET /api/v1/auth/status response shape', () => {
  it('never returns a raw session token', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/status')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('token')
  })

  it('never returns a proxyAuth field', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('proxyAuth')
  })

  it('exposes authenticated / hasUsers / required', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('authenticated')
    expect(body).toHaveProperty('hasUsers')
    expect(body).toHaveProperty('required')
  })

  it('authenticated=false and isAdmin=false for anonymous callers', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body.authenticated).toBe(false)
    expect(body.isAdmin).toBe(false)
    expect(body.userId).toBeUndefined()
  })

  it('anonymous response does NOT include version (fingerprint protection)', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('version')
  })

  it('anonymous response does NOT include proxyAuthEnabled (deployment topology)', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('proxyAuthEnabled')
  })

  it('anonymous response still includes oidcEnabled for login-screen UX', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('oidcEnabled')
  })
})

describe('GET /api/v1/auth/meta', () => {
  it('returns 401 for unauthenticated callers (non-degenerate state)', async () => {
    // Setup complete, users exist: auth is strictly required, 401 on miss.
    const app = createApp(
      makeDeps({
        isSetupComplete: async () => true,
        getUserCount: vi.fn(async () => 1),
      }),
    )
    const res = await app.request('/api/v1/auth/meta')
    expect(res.status).toBe(401)
  })

  it('exposes version / proxyAuthEnabled / oidcEnabled to authenticated callers', async () => {
    // Seed a session directly - the module-level vi.mock on @/config/env
    // freezes envConfig.authToken at undefined, so the legacy-token path is
    // unreachable. Session auth bypasses that.
    const SESSION_TOKEN = 'session-token-for-meta-test-abc123'
    await createSession(1, SESSION_TOKEN)
    const app = createApp(
      makeDeps({
        isSetupComplete: async () => true,
        getUserCount: vi.fn(async () => 1),
      }),
    )
    const res = await app.request('/api/v1/auth/meta', {
      headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('proxyAuthEnabled')
    expect(body).toHaveProperty('oidcEnabled')
  })
})

describe('authGuard degenerate state (setup complete + no users)', () => {
  it('returns 503 on auth-required endpoints', async () => {
    const app = createApp(
      makeDeps({
        isSetupComplete: async () => true,
        getUserCount: vi.fn(async () => 0),
      }),
    )
    // /api/auth/me is auth-required (not in PUBLIC_PATHS)
    const res = await app.request('/api/v1/auth/me')
    expect(res.status).toBe(503)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      type: '/problems/setup-admin-missing',
      title: 'Setup admin user missing',
      status: 503,
    })
  })
})
