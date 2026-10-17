import { isIP } from 'node:net'
import type { Context } from 'hono'
import { envConfig } from '@/config/env'
import { isIpTrusted } from '@/core/auth/cidr'

/** Only a trusted TCP peer may supply the forwarded client chain. */
export function getClientIp(c: Context): string | null {
  const env = c.env as
    | { remoteAddress?: string; incoming?: { socket?: { remoteAddress?: string } } }
    | undefined
  const socketIp = env?.remoteAddress ?? env?.incoming?.socket?.remoteAddress ?? null
  if (!socketIp) return socketIp
  const trustedProxies =
    envConfig.proxyAuthTrustedProxies
      ?.split(',')
      .map((cidr) => cidr.trim())
      .filter(Boolean) ?? []
  if (!isIpTrusted(socketIp, trustedProxies)) return socketIp

  const forwarded = c.req.header('X-Forwarded-For')
  if (!forwarded) return socketIp
  const chain = forwarded.split(',').map((ip) => ip.trim())
  if (chain.some((ip) => !isIP(ip))) return socketIp
  return chain.reverse().find((ip) => !isIpTrusted(ip, trustedProxies)) ?? socketIp
}
