// @vitest-environment node

import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { createApp } from '@/server'
import { albumBlocksRoutes } from '@/server/routes/album-blocks'
import { artistBlocksRoutes } from '@/server/routes/artist-blocks'
import type { HonoEnv } from '@/server/types'
import { makeDeps } from '../../helpers/test-app'

// Album and artist block lists share the same unauthenticated-access contract.
// Route-specific behavior stays in album-blocks.test.ts and artist-blocks.test.ts.
describe.each([
  ['album', '/api/v1/album-blocks', albumBlocksRoutes],
  ['artist', '/api/v1/artist-blocks', artistBlocksRoutes],
] as const)('GET %s block list authentication', (_name, path, routes) => {
  it('returns 401 when unauthenticated', async () => {
    const app = createApp(makeDeps())
    const res = await app.request(path)
    expect(res.status).toBe(401)
  })

  it('returns the canonical auth problem when mounted directly', async () => {
    const app = new Hono<HonoEnv>()
    app.route('/', routes(makeDeps()))

    const res = await app.request(path)
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="digarr"')
    expect(await res.json()).toEqual({
      type: '/problems/not-authenticated',
      title: 'Not authenticated',
      status: 401,
      code: 'errors.auth.notAuthenticated',
    })
  })
})
