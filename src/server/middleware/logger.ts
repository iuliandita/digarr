import type { MiddlewareHandler } from 'hono'

const LEVEL_COLORS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
} as const

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const STATIC_PREFIXES = ['/assets/', '/icon', '/theme-init.js', '/fonts/']
const STATIC_FILE = /\.(?:js|css|map|woff2?|ttf|otf|png|jpe?g|svg|ico|webp|webmanifest)$/

function isStaticPath(path: string): boolean {
  return (
    !path.startsWith('/api/') &&
    (STATIC_PREFIXES.some((p) => path.startsWith(p)) || STATIC_FILE.test(path))
  )
}

export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path
    // Skip health probes and static file noise
    if (path === '/health' || isStaticPath(path)) {
      await next()
      return
    }

    const start = Date.now()
    const method = c.req.method

    await next()

    const duration = Date.now() - start
    const status = c.res.status
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    const color = LEVEL_COLORS[level]
    const statusStr = `${color}${status}${RESET}`
    const durationStr =
      duration > 1000
        ? `${BOLD}${formatDuration(duration)}${RESET}`
        : `${DIM}${formatDuration(duration)}${RESET}`
    const contentLength = c.res.headers.get('content-length')
    const size = contentLength ? ` ${DIM}${contentLength}b${RESET}` : ''

    const msg = `${DIM}${timestamp()}${RESET} ${method} ${path} ${statusStr} ${durationStr}${size}`

    if (level === 'error') {
      console.error(msg)
    } else if (level === 'warn') {
      console.warn(msg)
    } else {
      console.log(msg)
    }
  }
}
