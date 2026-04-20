import { Hono } from 'hono'
import { isPrivateUrl } from '@/core/notifications'
import type { AppDependencies } from '@/server'

const ALLOWED_HOSTS = new Set(['img.theaudiodb.com', 'theaudiodb.com', 'www.theaudiodb.com'])

export function mediaRoutes(deps: AppDependencies) {
  const router = new Hono()

  router.get('/api/v1/media/image-proxy', async (c) => {
    const settings = await deps.getSettings()
    if (!settings?.audiodbProxyImages) {
      return c.json({ error: 'Not found' }, 404)
    }

    const src = c.req.query('src')
    if (!src) return c.json({ error: 'Missing src' }, 400)

    let url: URL
    try {
      url = new URL(src)
    } catch {
      return c.json({ error: 'Invalid src URL' }, 400)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return c.json({ error: 'Only http/https supported' }, 400)
    }
    if (!ALLOWED_HOSTS.has(url.hostname)) {
      return c.json({ error: 'Host not permitted' }, 400)
    }
    if (isPrivateUrl(url.href)) {
      return c.json({ error: 'Private address rejected' }, 400)
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      const upstream = await fetch(url.href, {
        redirect: 'manual',
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!upstream.ok) return c.json({ error: 'Upstream fetch failed' }, 502)
      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
      if (!contentType.startsWith('image/')) {
        return c.json({ error: 'Non-image content-type' }, 502)
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=86400',
        },
      })
    } catch {
      return c.json({ error: 'Upstream fetch failed' }, 502)
    }
  })

  return router
}
