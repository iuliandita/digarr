import { createMiddleware } from 'hono/factory'
import { generateSessionToken, hashPassword } from '@/core/auth'
import { isIpTrusted } from '@/core/auth/cidr'
import { createSession, getActiveSessionForUser } from '@/core/sessions'
import type { HonoEnv } from '@/server/types'

type ProxyAuthDeps = {
  enabled: boolean
  trustedProxies: string[]
  getUserByUsername: (username: string) => Promise<{ id: number; username: string } | null>
  createUser: (data: {
    username: string
    passwordHash: string
    isAdmin?: boolean
    email?: string
    authProvider?: string
  }) => Promise<{ id: number; username: string }>
  getUserCount: () => Promise<number>
}

/**
 * Extract the direct TCP peer IP from the request.
 *
 * SECURITY: We need the SOCKET-level IP (the reverse proxy itself),
 * NOT X-Forwarded-For (which is forgeable by any client). The trust
 * check validates that the direct connection comes from a known proxy.
 *
 * Bun runtime: `c.env?.remoteAddress` or the `conninfo` helper.
 * @hono/node-server: `c.env?.incoming?.socket?.remoteAddress`.
 * Tests: falls back to '0.0.0.0' (tests don't have a real socket).
 *
 * The implementer MUST verify which property exposes the socket IP
 * in the production runtime (Bun) and test runtime (Node/@hono/node-server).
 * Run `console.log(c.env)` in dev to inspect available properties.
 */
function getSocketIp(c: { env?: unknown }): string {
  const env = c.env as Record<string, unknown> | undefined
  // Bun adapter
  const bunAddr = env?.remoteAddress
  if (typeof bunAddr === 'string') return bunAddr

  // @hono/node-server adapter
  const incoming = env?.incoming as { socket?: { remoteAddress?: string } } | undefined
  const nodeAddr = incoming?.socket?.remoteAddress
  if (typeof nodeAddr === 'string') return nodeAddr

  // Fail closed: '0.0.0.0' won't match any sane trusted proxy CIDR
  return '0.0.0.0'
}

export function proxyAuthMiddleware(deps: ProxyAuthDeps) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    if (!deps.enabled) return next()

    const proxyIp = getSocketIp(c)
    if (!isIpTrusted(proxyIp, deps.trustedProxies)) return next()

    const rawForwardedUser = c.req.header('X-Forwarded-User')
    if (!rawForwardedUser) return next()
    const forwardedUser = rawForwardedUser.trim()
    if (forwardedUser.length === 0 || forwardedUser.length > 50) return next()

    const forwardedEmail = c.req.header('X-Forwarded-Email') ?? undefined

    // Find or create user
    let user = await deps.getUserByUsername(forwardedUser)
    if (!user) {
      const isFirstUser = (await deps.getUserCount()) === 0
      // Generate random password hash - proxy users authenticate via headers, not passwords
      const randomHash = hashPassword(crypto.randomUUID())
      user = await deps.createUser({
        username: forwardedUser,
        passwordHash: randomHash,
        isAdmin: isFirstUser,
        email: forwardedEmail,
        authProvider: 'proxy',
      })
    }

    // Reuse existing session or create new one (for SSE ?token= compatibility)
    let sessionToken = await getActiveSessionForUser(user.id)
    if (!sessionToken) {
      sessionToken = generateSessionToken()
      await createSession(user.id, sessionToken)
    }

    c.set('userId', user.id)
    c.set('proxyAuth', true)
    c.set('sessionToken', sessionToken)

    return next()
  })
}
