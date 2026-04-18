// @vitest-environment node

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { describe, expect, it } from 'vitest'
import { problem } from '@/server/helpers/problem'

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
})

describe('onError integration pattern', () => {
  it('translates HTTPException to problem+json via a mounted handler', async () => {
    const app = new Hono()
    app.onError((err, c) => {
      if (err instanceof HTTPException) {
        return problem(c, `http-${err.status}`, err.message || 'HTTP Error', err.status)
      }
      return problem(c, 'internal-error', 'Internal Server Error', 500)
    })
    app.get('/boom', () => {
      throw new HTTPException(422, { message: 'bad body' })
    })
    app.get('/crash', () => {
      throw new Error('kaboom')
    })

    const boom = await app.request('/boom')
    expect(boom.status).toBe(422)
    expect(await boom.json()).toMatchObject({
      type: '/problems/http-422',
      status: 422,
      title: 'bad body',
    })

    const crash = await app.request('/crash')
    expect(crash.status).toBe(500)
    expect(await crash.json()).toMatchObject({
      type: '/problems/internal-error',
      status: 500,
    })
  })
})
