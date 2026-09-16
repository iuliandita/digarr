import { randomBytes, randomUUID } from 'node:crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { hashPassword } from '@/core/auth'
import type { OidcAuthPurpose, OidcService } from '@/core/auth/oidc'
import { createSession, getSession } from '@/core/sessions'
import { SESSION_COOKIE_NAME } from '@/server/middleware/session-cookie'
import { oidcRoutes } from '@/server/routes/oidc'
import type { HonoEnv } from '@/server/types'

const MOCK_ORIGIN = 'http://127.0.0.1:3011'
const user = { id: 9001, username: 'oidc-browser' }
const localUser = {
  id: 9002,
  username: 'local-browser',
  passwordHash: hashPassword('local-password-123'),
  authProvider: 'local',
  oidcSubject: null,
}
let linkedSubject: string | null = null
let linkCount = 0
let createUserCount = 0

// state -> browser binding issued by getAuthorizationUrl. handleCallback proves
// the transaction-cookie round trip: the binding the route reads back from the
// digarr_oidc_<state> cookie must equal what was handed out for that state.
const issuedTransactions = new Map<string, { browserBinding: string; purpose: OidcAuthPurpose }>()

const oidcService = {
  getAuthorizationUrl: async (_redirectUri: string, purpose: OidcAuthPurpose) => {
    const state = randomUUID()
    const browserBinding = randomBytes(32).toString('base64url')
    issuedTransactions.set(state, { browserBinding, purpose })
    const url = `${MOCK_ORIGIN}/mock-provider?state=${state}&code=mock-code`
    return { url, state, browserBinding }
  },
  handleCallback: async (callbackUrl: URL, browserBinding?: string) => {
    const state = callbackUrl.searchParams.get('state') ?? ''
    const transaction = issuedTransactions.get(state)
    issuedTransactions.delete(state)
    if (!transaction || browserBinding !== transaction.browserBinding) {
      throw new Error('Unknown, expired, or invalid OIDC transaction')
    }
    return {
      purpose: transaction.purpose,
      claims: {
        sub: transaction.purpose.kind === 'link' ? 'browser-link-subject' : 'browser-oidc-subject',
        email: 'browser-oidc@example.test',
        emailVerified: true,
        preferredUsername: 'oidc-browser',
      },
    }
  },
} as unknown as OidcService

const app = new Hono<HonoEnv>()
app.use('/api/v1/auth/oidc/link', async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  const session = token ? await getSession(token) : null
  if (session) {
    c.set('userId', session.userId)
    c.set('authMethod', 'session-cookie')
  }
  await next()
})
app.route(
  '/',
  oidcRoutes({
    getOidcService: async () => oidcService,
    getUserByOidcSubject: async () => user,
    getUserByUsername: async () => user,
    createUser: async () => {
      createUserCount += 1
      throw new Error('mock OIDC user should already exist')
    },
    getUserCredentialsById: async (id) => (id === localUser.id ? localUser : null),
    linkOidcIdentity: async (params) => {
      if (params.userId !== localUser.id) throw new Error('unexpected link user')
      linkedSubject = params.oidcSubject
      linkCount += 1
    },
  }),
)

app.get('/mock-local-login', async (c) => {
  linkedSubject = null
  linkCount = 0
  createUserCount = 0
  const token = randomBytes(32).toString('base64url')
  await createSession(localUser.id, token)
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
    path: '/',
  })
  return c.redirect('/')
})

app.get('/mock-link-state', (c) => c.json({ linkedSubject, linkCount, createUserCount }))

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
app.get('/settings', (c) => c.html('<p>OIDC link callback complete</p>'))

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 3011 })
