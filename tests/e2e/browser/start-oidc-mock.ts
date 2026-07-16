import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { OidcService } from '@/core/auth/oidc'
import { oidcRoutes } from '@/server/routes/oidc'

const user = { id: 9001, username: 'oidc-browser' }
const oidcService = {
  handleCallback: async () => ({
    claims: {
      sub: 'browser-oidc-subject',
      email: 'browser-oidc@example.test',
      emailVerified: true,
      preferredUsername: 'oidc-browser',
    },
  }),
} as unknown as OidcService

const app = new Hono()
app.route(
  '/',
  oidcRoutes({
    getOidcService: async () => oidcService,
    getUserByOidcSubject: async () => user,
    getUserByUsername: async () => user,
    createUser: async () => {
      throw new Error('mock OIDC user should already exist')
    },
    getUserCount: async () => 1,
    updateUser: async () => {},
  }),
)
app.get('/', (c) => c.html('<p>OIDC callback complete</p>'))

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 3011 })
