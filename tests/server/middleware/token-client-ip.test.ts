// @vitest-environment node
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envConfig } from '@/config/env'
import { getClientIp } from '@/server/helpers/client-ip'
import { authGuard } from '@/server/middleware/auth'
import { __shutdownRateLimiter } from '@/server/middleware/rate-limit'
import type { HonoEnv } from '@/server/types'

const originalProxies = envConfig.proxyAuthTrustedProxies

afterEach(() => {
  Object.defineProperty(envConfig, 'proxyAuthTrustedProxies', { value: originalProxies })
  __shutdownRateLimiter()
})

function trustProxies() {
  Object.defineProperty(envConfig, 'proxyAuthTrustedProxies', {
    value: ' 192.0.2.0/24, 2001:db8:1::/48 ',
  })
}

describe('personal token client IP', () => {
  it.each([
    { socket: '203.0.113.1', xff: '198.51.100.1', expected: '203.0.113.1' },
    {
      socket: '192.0.2.1',
      xff: '203.0.113.9, 198.51.100.1, 192.0.2.2',
      expected: '198.51.100.1',
    },
    {
      socket: '::ffff:192.0.2.1',
      xff: '203.0.113.9, 198.51.100.1, ::ffff:192.0.2.2',
      expected: '198.51.100.1',
    },
    {
      socket: '2001:db8:1::1',
      xff: '2001:db8:2::1, 2001:db8:1::2',
      expected: '2001:db8:2::1',
    },
    ...[
      undefined,
      '',
      'garbage',
      '198.51.100.1,',
      'garbage, 198.51.100.1',
      '198.51.100.1:1234',
      '999.1.1.1',
      '192.0.2.2',
    ].map((xff) => ({
      socket: '192.0.2.1',
      xff,
      expected: '192.0.2.1',
    })),
  ])('resolves $socket with XFF=$xff to $expected', async ({ socket, xff, expected }) => {
    trustProxies()
    const app = new Hono()
    app.get('/', (c) => c.text(getClientIp(c) ?? 'unknown'))
    const headers: Record<string, string> = xff === undefined ? {} : { 'X-Forwarded-For': xff }
    for (const env of [
      { remoteAddress: socket },
      { incoming: { socket: { remoteAddress: socket } } },
    ]) {
      expect(await (await app.request('/', { headers }, env)).text()).toBe(expected)
    }
  })

  it.each([
    { socket: '203.0.113.1', separate: false },
    { socket: '192.0.2.1', separate: true },
    { socket: '::ffff:192.0.2.1', separate: true },
  ])('isolates forwarded budgets only for trusted socket $socket', async ({ socket, separate }) => {
    trustProxies()
    const resolveApiToken = vi.fn(async (token: string) =>
      token === 'dga_valid' ? { userId: 1, scope: 'read' as const } : null,
    )
    const app = new Hono<HonoEnv>()
    app.use(
      '*',
      authGuard({
        hasUsers: async () => true,
        isSetupComplete: async () => true,
        resolveApiToken,
      }),
    )
    app.get('/api/v1/test', (c) => c.text('ok'))
    const request = (token: string, client: string) =>
      app.request(
        '/api/v1/test',
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Forwarded-For': `203.0.113.9, ${client}, 192.0.2.2`,
          },
        },
        { remoteAddress: socket },
      )
    for (let i = 0; i < 20; i++) {
      expect((await request('dga_invalid', '198.51.100.1')).status).toBe(401)
    }
    resolveApiToken.mockClear()
    expect((await request('dga_valid', '198.51.100.1')).status).toBe(429)
    expect(resolveApiToken).not.toHaveBeenCalled()
    expect((await request('dga_valid', '198.51.100.2')).status).toBe(separate ? 200 : 429)
    expect(resolveApiToken).toHaveBeenCalledTimes(separate ? 1 : 0)
  })
})
