// @vitest-environment node

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { describe, expect, it } from 'vitest'
import { readPagination } from '@/server/helpers/pagination'
import { encodeCursor } from '@/server/helpers/pagination-cursor'

function paginationApp() {
  const app = new Hono()
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status)
    }
    throw err
  })
  app.get('/probe', (c) => c.json({ page: readPagination(c) }))
  return app
}

describe('readPagination', () => {
  it('keeps the legacy unpaginated shape when no pagination params are present', async () => {
    const res = await paginationApp().request('/probe')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ page: null })
  })

  it('uses the default limit and decoded cursor when only cursor is present', async () => {
    const cursor = encodeCursor({ id: 7, ts: '2026-01-02T03:04:05.000Z' })
    const res = await paginationApp().request(`/probe?cursor=${encodeURIComponent(cursor)}`)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      page: {
        limit: 50,
        cursor: { id: 7, ts: '2026-01-02T03:04:05.000Z' },
      },
    })
  })

  it('rejects non-integer limits with 400', async () => {
    const res = await paginationApp().request('/probe?limit=abc')

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'limit must be an integer' })
  })
})
