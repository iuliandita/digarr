// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { SetupAlreadyCompleteError, SetupOwnerRequiredError } from '@/db/queries/setup'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'
import { makeDeps as makeSharedDeps } from '../../helpers/test-app'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '93.184.216.34', family: 4 })),
}))

vi.mock('@/core/sessions', async () => {
  const actual = await vi.importActual<typeof import('@/core/sessions')>('@/core/sessions')
  return {
    ...actual,
    getSession: vi.fn(async (token: string) =>
      token === 'test-session-token' ? { userId: 42, token } : null,
    ),
  }
})

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return makeSharedDeps({
    storeDb: {} as unknown as AppDependencies['storeDb'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    isSetupComplete: vi.fn(async () => false),
    getSettings: vi.fn(async () => null),
    completeSetup: vi.fn(async () => ({ id: 1, setupComplete: true })),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 0),
    ...overrides,
  })
}

describe('GET /api/v1/setup/status', () => {
  it('returns setupComplete: false when setup is not done', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/setup/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.setupComplete).toBe(false)
  })

  it('returns setupComplete: true after setup is complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => true }))
    const res = await app.request('/api/v1/setup/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.setupComplete).toBe(true)
  })
})

describe('POST /api/v1/setup/complete', () => {
  const validBody = {
    lidarrUrl: 'http://lidarr:8686',
    lidarrApiKey: 'abc123',
    aiProvider: 'ollama',
    aiModel: 'llama3',
  }

  it('accepts valid config and returns 204', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(204)
  })

  it('calls completeSetup with the config', async () => {
    const completeSetup = vi.fn(async () => ({ id: 1, setupComplete: true }))
    const app = createApp(makeDeps({ completeSetup }))
    await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
      body: JSON.stringify(validBody),
    })
    expect(completeSetup).toHaveBeenCalledTimes(1)
  })

  it('rejects missing lidarrUrl with 400', async () => {
    const app = createApp(makeDeps())
    const { lidarrUrl: _, ...body } = validBody
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing lidarrApiKey with 400', async () => {
    const app = createApp(makeDeps())
    const { lidarrApiKey: _, ...body } = validBody
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing aiProvider with 400', async () => {
    const app = createApp(makeDeps())
    const { aiProvider: _, ...body } = validBody
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing aiModel with 400', async () => {
    const app = createApp(makeDeps())
    const { aiModel: _, ...body } = validBody
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
  })

  it('accepts AI-only setup in discovery mode', async () => {
    const app = createApp(makeDeps())
    const body = {
      aiProvider: 'ollama',
      aiModel: 'llama3',
    }
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(204)
  })

  it('accepts setup without an AI provider (#887)', async () => {
    const completeSetup = vi.fn(async () => ({ id: 1, setupComplete: true }))
    const app = createApp(makeDeps({ completeSetup }))
    for (const body of [{}, { aiProvider: ' ' }]) {
      const anonymous = await app.request('/api/v1/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(anonymous.status).toBe(401)
    }

    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(204)
    expect(completeSetup).toHaveBeenCalledTimes(1)
    expect(completeSetup).toHaveBeenCalledWith({}, expect.anything())
  })

  it('strips legacy listening-source fields before persisting setup', async () => {
    const completeSetup = vi.fn(async () => ({ id: 1, setupComplete: true }))
    const app = createApp(makeDeps({ completeSetup }))
    const body = {
      ...validBody,
      listenbrainzUsername: 'legacy-lb',
      listenbrainzToken: 'legacy-token',
      lastfmUsername: 'legacy-lastfm',
      lastfmApiKey: 'legacy-key',
    }
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(204)
    expect(completeSetup).toHaveBeenCalledWith(
      {
        lidarrUrl: 'http://lidarr:8686',
        lidarrApiKey: 'abc123',
        aiProvider: 'ollama',
        aiModel: 'llama3',
      },
      { userId: 42 },
    )
  })

  it('rejects emby fields when apiKey or userId are missing', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
      body: JSON.stringify({
        embyUrl: 'http://emby:8096',
        aiProvider: 'ollama',
        aiModel: 'llama3',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('hands Emby credentials and ownership to atomic completion', async () => {
    const deps = makeDeps()
    const res = await createApp(deps).request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
      body: JSON.stringify({
        embyUrl: 'http://emby:8096',
        embyApiKey: 'key',
        embyUserId: 'user-1',
        skipTlsVerify: true,
        aiProvider: 'ollama',
        aiModel: 'llama3',
      }),
    })
    expect(res.status).toBe(204)
    expect(deps.completeSetup).toHaveBeenCalledWith(
      { skipTlsVerify: true, aiProvider: 'ollama', aiModel: 'llama3' },
      { userId: 42, emby: { url: 'http://emby:8096', apiKey: 'key', userId: 'user-1' } },
    )
    expect(deps.targetQueries.createTarget).not.toHaveBeenCalled()
  })

  it.each([
    { lidarrUrl: 'http://lidarr:8686', lidarrApiKey: 'key' },
    { embyUrl: 'http://emby:8096', embyApiKey: 'key', embyUserId: 'user-1' },
  ])('requires an owner for requested services before writes: %o', async (service) => {
    const deps = makeDeps()
    const res = await createApp(deps).request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiProvider: 'ollama', aiModel: 'llama3', ...service }),
    })
    expect(res.status).toBe(401)
    expect(deps.completeSetup).not.toHaveBeenCalled()
    expect(deps.targetQueries.createTarget).not.toHaveBeenCalled()
  })

  it.each([
    { error: new Error('private-api-key'), status: 500 },
    { error: new SetupOwnerRequiredError(), status: 401 },
    { error: new SetupAlreadyCompleteError(), status: 409 },
  ])('reports persistence failures safely with status $status', async ({ error, status }) => {
    const secret = 'private-api-key'
    const deps = makeDeps({ completeSetup: vi.fn().mockRejectedValue(error) })
    const res = await createApp(deps).request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
      body: JSON.stringify({ ...validBody, lidarrApiKey: secret }),
    })
    expect(res.status).toBe(status)
    if (status !== 409)
      expect(res.headers.get('content-type')).toContain('application/problem+json')
    const response = await res.json()
    if (status === 500) expect(response).toEqual(expect.objectContaining({ code: 'setup.failed' }))
    expect(JSON.stringify(response)).not.toContain(secret)
  })
})
