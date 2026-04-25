import { resolve } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { envConfig } from '@/config/env'
import { VERSION } from '@/version'
import { openapiDoc } from './helpers/openapi-doc'
import { problem } from './helpers/problem'
import { adminGuard } from './middleware/admin-guard'
import { apiVersionRedirect } from './middleware/api-version'
import { authGuard } from './middleware/auth'
import { requestLogger } from './middleware/logger'
import { proxyAuthMiddleware } from './middleware/proxy-auth'
import { rateLimiter } from './middleware/rate-limit'
import { setupGuard } from './middleware/setup-guard'
import { adminRoutes } from './routes/admin'
import { analyticsRoutes } from './routes/analytics'
import { artistBlocksRoutes } from './routes/artist-blocks'
import { artistRoutes } from './routes/artists'
import { authRoutes } from './routes/auth'
import { batchRoutes } from './routes/batches'
import { dashboardRoutes } from './routes/dashboard'
import { discoveryModeRoutes } from './routes/discovery-modes'
import { exportRoutes } from './routes/exports'
import { genreRoutes } from './routes/genres'
import { healthRoutes } from './routes/health'
import { jobRoutes } from './routes/jobs'
import { libraryRoutes } from './routes/library'
import { lidarrRoutes } from './routes/lidarr'
import { listeningRoutes } from './routes/listening'
import { mediaRoutes } from './routes/media'
import { moodRoutes } from './routes/mood'
import { oauthRoutes } from './routes/oauth'
import { oidcRoutes } from './routes/oidc'
import { pipelineRoutes } from './routes/pipeline'
import { playlistRoutes } from './routes/playlists'
import { recommendationRoutes } from './routes/recommendations'
import { searchRoutes } from './routes/search'
import { settingsRoutes } from './routes/settings'
import { setupRoutes } from './routes/setup'
import { slskdRoutes } from './routes/slskd'
import { subscriptionRoutes } from './routes/subscriptions'
import { targetRoutes } from './routes/targets'
import { userRoutes } from './routes/users'
import type { HonoEnv } from './types'

// AppDependencies is the intersection of every per-domain slice in deps.ts.
// Route files that only need a subset (see TargetDeps / LibraryDeps / etc.
// already defined locally in some routes) can import from `./deps` instead
// of accepting the full bag. Keeping this re-export stable avoids breaking
// every caller.
export type { AppDependencies } from './deps'

import type { AppDependencies } from './deps'

export function createApp(deps: AppDependencies) {
  const app = new Hono<HonoEnv>()

  // Central error handler: maps HTTPException (including zJson's hook failures
  // when a handler throws one) and unknown errors to RFC 9457 problem+json.
  // Zod/validator hooks still return their {error, code, details} shape
  // directly so existing clients keep working; only unhandled throws flow here.
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const res = err.getResponse()
      // If the exception already carries a fully-formed response (e.g. from a
      // middleware that built its own body), prefer it over the problem+json
      // envelope to avoid clobbering specialised payloads.
      if (res.headers.get('content-type')?.includes('application/json')) return res
      return problem(c, `http-${err.status}`, err.message || 'HTTP Error', err.status, undefined)
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[server] unhandled error:', msg, err instanceof Error ? err.stack : '')
    return problem(c, 'internal-error', 'Internal Server Error', 500)
  })

  // 404 for unmatched /api/* requests. Non-API paths fall through to the SPA
  // static serving in production, so we only intercept API routes here.
  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return problem(c, 'not-found', 'Not Found', 404, `No route for ${c.req.method} ${c.req.path}`)
    }
    return c.text('Not Found', 404)
  })

  // Log all requests first - before auth/cors so we capture everything
  app.use('*', requestLogger())

  // 308-redirect legacy /api/* to /api/v1/*. Must run before any route is
  // mounted so a legacy request never reaches a handler mounted under
  // /api/v1/*. Emits Deprecation + Sunset headers for RFC 9745/8594 clients.
  app.use('*', apiVersionRedirect)

  if (!envConfig.allowedOrigin && process.env.NODE_ENV === 'production') {
    console.warn(
      'ALLOWED_ORIGIN is not set in production - CORS will reject cross-origin requests. Set ALLOWED_ORIGIN to your app URL.',
    )
  }
  app.use(
    '*',
    cors({
      origin:
        envConfig.allowedOrigin ?? (process.env.NODE_ENV === 'production' ? () => undefined : '*'),
    }),
  )
  app.use(
    '*',
    secureHeaders({
      xFrameOptions: 'DENY',
      xContentTypeOptions: 'nosniff',
      referrerPolicy: 'strict-origin-when-cross-origin',
      crossOriginOpenerPolicy: 'same-origin',
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https:'],
        fontSrc: ["'self'"],
        frameSrc: ["'self'", 'https://open.spotify.com'],
      },
    }),
  )
  app.use(
    '*',
    proxyAuthMiddleware({
      enabled: envConfig.proxyAuthEnabled,
      trustedProxies:
        envConfig.proxyAuthTrustedProxies
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) ?? [],
      getUserByUsername: deps.getUserByUsername,
      createUser: deps.createUser,
      getUserCount: deps.getUserCount,
    }),
  )
  app.use(
    '*',
    authGuard({
      hasUsers: async () => (await deps.getUserCount()) > 0,
      isSetupComplete: deps.isSetupComplete,
    }),
  )
  app.use('*', setupGuard(deps.isSetupComplete))

  // Auth status (optional auth - tells the frontend whether auth is required
  // AND whether the caller is already authenticated via session cookie / bearer
  // token / proxy auth. Never returns a raw session token: the cookie handles
  // authentication on subsequent requests.
  //
  // Deployment-fingerprint fields (version, proxyAuthEnabled) live on
  // `/api/v1/auth/meta` behind auth so an unauthenticated attacker cannot
  // enumerate the build or infer deployment topology. `oidcEnabled` stays
  // here because the login screen needs it to render the SSO button.
  app.get('/api/v1/auth/status', async (c) => {
    const [userCount, setupComplete] = await Promise.all([
      deps.getUserCount(),
      deps.isSetupComplete(),
    ])
    const userId = c.get('userId')
    const user = typeof userId === 'number' ? await deps.getUserById(userId) : null
    const settings = await deps.getSettings()
    const oidcEnabled = !!(settings?.oidcIssuerUrl && settings.oidcClientId)

    return c.json({
      authenticated: !!user,
      userId: user?.id,
      isAdmin: user?.isAdmin ?? false,
      required: userCount > 0 || !!envConfig.authToken || setupComplete,
      hasUsers: userCount > 0,
      oidcEnabled,
    })
  })

  // Authenticated-only deployment metadata. Splits fingerprint-sensitive
  // fields off the public /api/auth/status surface. Not listed in
  // PUBLIC_PATHS / OPTIONAL_AUTH_PATHS, so authGuard enforces a 401 for
  // unauthenticated callers.
  app.get('/api/v1/auth/meta', async (c) => {
    const settings = await deps.getSettings()
    return c.json({
      version: VERSION,
      oidcEnabled: !!(settings?.oidcIssuerUrl && settings.oidcClientId),
      proxyAuthEnabled: envConfig.proxyAuthEnabled,
    })
  })

  // OpenAPI 3.1 spec. Intentionally public so integrators can read the
  // contract without credentials. The spec is a skeleton today - see
  // src/server/helpers/openapi-doc.ts. `/api/v1/docs` returns a tiny
  // no-external-JS landing page pointing at the spec; rendering with
  // Scalar/Swagger is deferred to keep the CSP strict.
  app.get('/api/v1/docs/openapi.json', (c) =>
    c.json(openapiDoc, 200, { 'cache-control': 'public, max-age=60' }),
  )
  app.get(
    '/api/v1/docs',
    (_c) =>
      new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>digarr API</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5}code{background:#f4f4f4;padding:.1rem .3rem;border-radius:.2rem}</style>
</head><body>
<h1>digarr API</h1>
<p>The machine-readable OpenAPI 3.1 specification is served at
<a href="/api/v1/docs/openapi.json"><code>/api/v1/docs/openapi.json</code></a>.</p>
<p>Paste the URL into your favourite viewer (Scalar, Swagger UI, Redoc, Insomnia, Bruno, Postman) to browse it interactively.</p>
</body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      ),
  )

  app.route(
    '/',
    oidcRoutes({
      getOidcService: deps.getOidcService,
      getUserByOidcSubject: deps.getUserByOidcSubject,
      getUserByEmail: deps.getUserByEmail,
      getUserByUsername: deps.getUserByUsername,
      createUser: deps.createUser,
      getUserCount: deps.getUserCount,
      updateUser: deps.updateUser,
    }),
  )
  // Rate limit auth endpoints: 10 attempts per minute for login/register
  app.use('/api/v1/auth/login', rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'auth' }))
  app.use('/api/v1/auth/register', rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'reg' }))
  app.use(
    '/api/v1/auth/change-password',
    rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'chpw' }),
  )
  // Rate limit AI-consuming endpoints to prevent API budget exhaustion
  app.use('/api/v1/mood/discover', rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'mood' }))
  app.use(
    '/api/v1/pipeline/quick-discover',
    rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'qdsc' }),
  )
  app.route('/', authRoutes(deps))
  app.route('/', oauthRoutes(deps))
  app.route('/', healthRoutes({ db: deps.db }))
  app.route('/', setupRoutes(deps))
  app.route('/', settingsRoutes(deps))
  app.route('/', pipelineRoutes(deps))
  app.route('/', recommendationRoutes(deps))
  app.route('/', batchRoutes(deps))
  app.use('/api/v1/admin/*', adminGuard(deps.getUserById))
  app.use('/api/v1/analytics/*', adminGuard(deps.getUserById))

  app.route(
    '/',
    adminRoutes({
      db: deps.db,
      getUserById: deps.getUserById,
      getSettings: deps.getSettings,
      generateReasoning: async (artistName, genres) => {
        const settings = await deps.getSettings()
        const s = settings as Record<string, unknown> | null
        if (!s?.aiProvider) throw new Error('No AI provider configured')
        const provider = await deps.providerRegistry.create(s.aiProvider as string, {
          apiKey: (s.aiApiKey as string) ?? null,
          model: (s.aiModel as string) ?? '',
          baseUrl: (s.aiBaseUrl as string) ?? null,
          timeoutSeconds: envConfig.aiTimeoutSeconds ?? null,
        })
        const genreList = genres.length > 0 ? genres.join(', ') : 'unknown'
        const results = await provider.getRecommendations({
          topArtists: [],
          topGenres: [],
          listeningPatterns: { totalListens: 0, recentTrend: 'stable' },
          _rawPrompt: `Describe the artist ${JSON.stringify(artistName)} (genres: ${genreList}) in 2-3 sentences. First describe what they sound like and what they're known for, then explain why fans of ${genreList} might enjoy them. Return ONLY a JSON array with one element: [{"artistName":${JSON.stringify(artistName)},"reasoning":"...","confidence":0.8,"genres":${JSON.stringify(genres)}}]`,
        })
        return results[0]?.reasoning ?? `${artistName} is an artist in the ${genreList} genre.`
      },
    }),
  )
  app.route('/', analyticsRoutes(deps))
  app.route('/', artistRoutes(deps))
  app.route('/', mediaRoutes(deps))
  app.route('/', lidarrRoutes(deps))
  app.route('/', listeningRoutes(deps))
  app.route('/', discoveryModeRoutes(deps))
  app.route('/', genreRoutes(deps))
  app.route('/', subscriptionRoutes(deps))
  app.route('/', userRoutes(deps))
  app.route('/', targetRoutes(deps))
  if (deps.slskdOrchestrator) {
    app.route(
      '/',
      slskdRoutes({
        getUserById: deps.getUserById,
        slskdOrchestrator: deps.slskdOrchestrator,
      }),
    )
  }
  app.route('/', dashboardRoutes(deps))
  app.route(
    '/',
    artistBlocksRoutes({
      listArtistBlocks: deps.listArtistBlocks,
      removeArtistBlock: deps.removeArtistBlock,
      addArtistBlock: deps.addArtistBlock,
    }),
  )
  app.route(
    '/',
    jobRoutes({
      getUserById: deps.getUserById,
      jobQueries: deps.jobQueries,
      scheduler: {
        get nextRun() {
          return deps.scheduler.nextRun('main-pipeline')
        },
      },
    }),
  )
  app.route('/', exportRoutes(deps))
  if (deps.playlistDeps) {
    app.route('/', playlistRoutes(deps.playlistDeps))
  }
  app.route(
    '/',
    moodRoutes({
      getSettings: deps.getSettings,
      getUserById: deps.getUserById,
      providerRegistry: deps.providerRegistry,
    }),
  )
  app.route(
    '/',
    libraryRoutes({
      libraryHealth: deps.libraryHealth,
      skyhookWarmer: deps.skyhookWarmer,
      librarySync: deps.librarySync,
      librarySyncStore: deps.librarySyncStore,
      getSettings: deps.getSettings,
      albumCoverage: deps.albumCoverage ?? {
        getCoverageForArtist: async () => {
          throw new Error('Album coverage service not configured')
        },
      },
      getUserById: deps.getUserById,
    }),
  )
  if (deps.search) {
    app.route('/', searchRoutes(deps.search))
  }

  // Serve built SPA in production (dev uses Vite's dev server with proxy)
  // Absolute path required: @hono/node-server serveStatic resolves relative
  // to the module directory (dist/server/), not process.cwd()
  if (process.env.NODE_ENV === 'production') {
    const webRoot = resolve(process.cwd(), 'dist/web')
    app.use('/*', serveStatic({ root: webRoot }))
    app.get('*', serveStatic({ root: webRoot, path: 'index.html' }))
  }

  return app
}
