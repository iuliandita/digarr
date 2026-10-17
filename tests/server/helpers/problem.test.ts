// @vitest-environment node

import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { createSession } from '@/core/sessions'
import { notFoundProblem, problem } from '@/server/helpers/problem'
import { createTestApp } from '../../helpers/test-app'

describe('problem helper', () => {
  it('returns RFC 9457 envelope with application/problem+json', async () => {
    const app = new Hono()
    app.get('/boom', (c) => problem(c, 'bad-input', 'Bad input', 400, 'details here'))

    const res = await app.request('/boom')
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    const body = await res.json()
    expect(body).toEqual({
      type: '/problems/bad-input',
      title: 'Bad input',
      status: 400,
      detail: 'details here',
    })
  })

  it('omits detail when not provided', async () => {
    const app = new Hono()
    app.get('/boom', (c) => problem(c, 'forbidden', 'Forbidden', 403))

    const res = await app.request('/boom')
    const body = await res.json()
    expect(body.detail).toBeUndefined()
  })

  it('accepts extension fields', async () => {
    const app = new Hono()
    app.get('/boom', (c) =>
      problem(c, 'rate-limited', 'Too Many Requests', 429, 'slow down', { retryAfter: 42 }),
    )

    const res = await app.request('/boom')
    const body = (await res.json()) as { retryAfter?: number }
    expect(body.retryAfter).toBe(42)
  })

  it('returns a coded 404 without placeholder arguments', async () => {
    const app = new Hono()
    app.get('/missing', (c) =>
      notFoundProblem(c, 'widget-not-found', 'Widget not found', 'errors.widget.notFound'),
    )

    const res = await app.request('/missing')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    expect(await res.json()).toEqual({
      type: '/problems/widget-not-found',
      title: 'Widget not found',
      status: 404,
      code: 'errors.widget.notFound',
    })
  })
})

describe('app error handler', () => {
  it('maps a thrown HTTPException to a problem with the reason phrase and message', async () => {
    const { app } = createTestApp()
    await createSession(1, 'problem-test-token')

    const res = await app.request('/api/v1/genres/rock/artists?limit=abc', {
      headers: { Authorization: 'Bearer problem-test-token' },
    })

    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toBe('application/problem+json')
    expect(await res.json()).toEqual({
      type: '/problems/http-400',
      title: 'Bad Request',
      status: 400,
      detail: 'limit must be an integer',
    })
  })
})
