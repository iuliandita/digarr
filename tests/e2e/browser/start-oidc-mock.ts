import { randomBytes, randomUUID } from 'node:crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { OidcService } from '@/core/auth/oidc'
import { oidcRoutes } from '@/server/routes/oidc'

const MOCK_ORIGIN = 'http://127.0.0.1:3011'
const user = { id: 9001, username: 'oidc-browser' }

// state -> browser binding issued by getAuthorizationUrl. handleCallback proves
// the transaction-cookie round trip: the binding the route reads back from the
// digarr_oidc_<state> cookie must equal what was handed out for that state.
const issuedBindings = new Map<string, string>()

const oidcService = {
  getAuthorizationUrl: async (_redirectUri: string) => {
    const state = randomUUID()
    const browserBinding = randomBytes(32).toString('base64url')
    issuedBindings.set(state, browserBinding)
    const url = `${MOCK_ORIGIN}/mock-provider?state=${state}&code=mock-code`
    return { url, state, browserBinding }
  },
  handleCallback: async (callbackUrl: URL, browserBinding?: string) => {
    const state = callbackUrl.searchParams.get('state') ?? ''
    const expected = issuedBindings.get(state)
    issuedBindings.delete(state)
    if (!expected || browserBinding !== expected) {
      throw new Error('Unknown, expired, or invalid OIDC transaction')
    }
    return {
      claims: {
        sub: 'browser-oidc-subject',
        email: 'browser-oidc@example.test',
        emailVerified: true,
        preferredUsername: 'oidc-browser',
      },
    }
  },
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

// Provider stand-in: bounce straight back to the real callback route with the
// same state, mimicking an IdP redirect after user consent.
app.get('/mock-provider', (c) => {
  const params = new URL(c.req.url).searchParams
  const state = params.get('state') ?? ''
  const code = params.get('code') ?? 'mock-code'
  return c.redirect(
    `/api/v1/auth/oidc/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,
  )
})

app.get('/', (c) => c.html('<p>OIDC callback complete</p>'))

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 3011 })
