// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'
import { isMaintenance, setMaintenance } from '@/server/maintenance'
import { createTestApp } from '../helpers/test-app'

const SESSION_TOKEN = 'maintenance-test-session-abc'

beforeEach(async () => {
  await clearAllSessions()
})

afterEach(async () => {
  setMaintenance(false)
  await clearAllSessions()
})

describe('setMaintenance / isMaintenance', () => {
  it('defaults to false', () => {
    expect(isMaintenance()).toBe(false)
  })

  it('setMaintenance(true) flips to true', () => {
    try {
      setMaintenance(true)
      expect(isMaintenance()).toBe(true)
    } finally {
      setMaintenance(false)
    }
  })

  it('setMaintenance(false) flips back to false', () => {
    try {
      setMaintenance(true)
      setMaintenance(false)
      expect(isMaintenance()).toBe(false)
    } finally {
      setMaintenance(false)
    }
  })
})

describe('maintenanceMiddleware app-level', () => {
  it('returns 503 with code=maintenance for a mutating request during maintenance', async () => {
    const { app } = createTestApp()
    // POST /api/v1/auth/login is in PUBLIC_PATHS so authGuard passes through;
    // the maintenance middleware then intercepts the write before any handler runs.
    try {
      setMaintenance(true)
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pw' }),
      })
      expect(res.status).toBe(503)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe('maintenance')
      expect(typeof body.error).toBe('string')
    } finally {
      setMaintenance(false)
    }
  })

  it('passes GET requests through during maintenance', async () => {
    const { app } = createTestApp()
    try {
      setMaintenance(true)
      const res = await app.request('/api/v1/auth/status')
      expect(res.status).not.toBe(503)
    } finally {
      setMaintenance(false)
    }
  })

  it('does not block requests to the migrate-backend prefix during maintenance', async () => {
    const { app } = createTestApp()
    await createSession(1, SESSION_TOKEN)
    try {
      setMaintenance(true)
      // The migration route does not exist yet; it will 404.
      // The important assertion is that the maintenance middleware does NOT return 503.
      const res = await app.request('/api/v1/admin/migrate-backend', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SESSION_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(res.status).not.toBe(503)
    } finally {
      setMaintenance(false)
    }
  })

  it('does not return 503 when maintenance is off', async () => {
    const { app } = createTestApp()
    // Maintenance is off (default); writes must flow through normally.
    const res = await app.request('/api/v1/auth/status')
    expect(res.status).not.toBe(503)
  })
})
