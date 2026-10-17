// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createTestApp } from '../helpers/test-app'

describe('API routing', () => {
  it('returns a problem response instead of redirecting unversioned routes', async () => {
    const { app } = createTestApp()

    const response = await app.request('/api/auth/status', { redirect: 'manual' })

    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('deprecation')).toBeNull()
    expect(response.headers.get('sunset')).toBeNull()
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(await response.json()).toMatchObject({
      type: '/problems/not-found',
      title: 'Not Found',
      status: 404,
    })
  })

  it('converts legacy error bodies to problem+json and keeps the error member', async () => {
    const { app } = createTestApp()

    const response = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    const body = await response.json()
    expect(body).toMatchObject({ type: '/problems/http-400', title: 'Bad Request', status: 400 })
    expect(body.detail).toEqual(expect.any(String))
    expect(body.error).toBe(body.detail)
  })

  it('keeps versioned routes available', async () => {
    const { app } = createTestApp()

    const response = await app.request('/api/v1/auth/status')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ required: expect.any(Boolean) })
  })
})
