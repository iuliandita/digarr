import { serveStatic } from '@hono/node-server/serve-static'
import type { Env, Hono } from 'hono'

const IMMUTABLE = 'public, max-age=31536000, immutable'

export function mountStatic<E extends Env>(app: Hono<E>, webRoot: string): void {
  app.use('/*', async (c, next) => {
    await next()
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return
    if (c.res.status !== 200 && c.res.status !== 304) return
    if (c.res.headers.has('cache-control')) return
    const type = c.res.headers.get('content-type') ?? ''
    const path = c.req.path
    // A missing hashed asset falls through to the SPA fallback (html), which must not be pinned.
    if (path.startsWith('/assets/') && !type.startsWith('text/html')) {
      c.res.headers.set('cache-control', IMMUTABLE)
      // The sandboxed Spotify bridge iframe has an opaque origin, so its module scripts are CORS requests with Origin: null.
      c.res.headers.set('access-control-allow-origin', '*')
    } else if (type.startsWith('text/html') || path === '/sw.js') {
      c.res.headers.set('cache-control', 'no-cache')
    }
  })
  app.use('/*', serveStatic({ root: webRoot }))
  app.get('*', serveStatic({ root: webRoot, path: 'index.html' }))
}
