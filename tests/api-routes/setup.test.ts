// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createTestApp } from '../helpers/test-app'

describe('API routes: setup', () => {
  it('returns setup status correctly', async () => {
    const { app } = createTestApp({
      isSetupComplete: vi.fn(async () => false),
      getUserCount: vi.fn(async () => 0),
    })

    const statusRes = await app.request('/api/v1/setup/status')
    expect(statusRes.status).toBe(200)
    const body = await statusRes.json()
    expect(body.setupComplete).toBe(false)
  })

  it('rejects setup/complete when setup is already done', async () => {
    // getUserCount=0 so auth is skipped (no users registered yet)
    const { app } = createTestApp({
      isSetupComplete: vi.fn(async () => true),
      getUserCount: vi.fn(async () => 0),
    })

    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'discover' }),
    })
    expect(res.status).toBe(409)
  })

  it('completes setup and calls completeSetup when fields are valid', async () => {
    const completeSetup = vi.fn(async () => ({ success: true }))
    const { app } = createTestApp({
      isSetupComplete: vi.fn(async () => false),
      getUserCount: vi.fn(async () => 0),
      completeSetup,
    })

    const completeRes = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiProvider: 'openai',
        aiModel: 'gpt-4o',
      }),
    })
    expect(completeRes.status).toBe(204)
    expect(completeSetup).toHaveBeenCalled()
  })

  it('returns 400 for missing required fields', async () => {
    const { app } = createTestApp({
      isSetupComplete: vi.fn(async () => false),
      getUserCount: vi.fn(async () => 0),
    })

    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'discover' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.fields).toBeDefined()
  })

  it('ignores legacy listening-source fields during setup completion', async () => {
    const completeSetup = vi.fn(async () => ({ success: true }))
    const { app } = createTestApp({
      isSetupComplete: vi.fn(async () => false),
      getUserCount: vi.fn(async () => 0),
      completeSetup,
    })

    const completeRes = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiProvider: 'openai',
        aiModel: 'gpt-4o',
        listenbrainzUsername: 'legacy-lb',
        lastfmUsername: 'legacy-lastfm',
      }),
    })
    expect(completeRes.status).toBe(204)
    expect(completeSetup).toHaveBeenCalledWith(
      expect.not.objectContaining({
        listenbrainzUsername: expect.anything(),
        lastfmUsername: expect.anything(),
      }),
    )
  })
})
