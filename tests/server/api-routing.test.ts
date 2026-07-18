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

  it('keeps versioned routes available', async () => {
    const { app } = createTestApp()

    const response = await app.request('/api/v1/auth/status')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ required: expect.any(Boolean) })
  })
})
