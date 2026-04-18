import { readFileSync } from 'node:fs'
import { assertCidr } from '@/core/auth/cidr'

function env(key: string): string | undefined {
  const val = process.env[key]
  return val || undefined
}

/**
 * Read an env var, falling back to the file referenced by `${key}_FILE`.
 * Enables the Docker / Compose secrets convention without forcing users to
 * inline sensitive values in shell env. Returns undefined if both miss.
 */
function envOrFile(key: string): string | undefined {
  const direct = env(key)
  if (direct) return direct
  const filePath = env(`${key}_FILE`)
  if (!filePath) return undefined
  try {
    return readFileSync(filePath, 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}

function envBool(key: string, fallback = false): boolean {
  const val = process.env[key]
  if (!val) return fallback
  return val === 'true' || val === '1'
}

function envInt(key: string): number | undefined {
  const val = process.env[key]
  if (!val) return undefined
  const n = Number.parseInt(val, 10)
  return Number.isNaN(n) ? undefined : n
}

function envOneOf<const T extends readonly string[]>(
  key: string,
  allowed: T,
): T[number] | undefined {
  const val = process.env[key]
  if (!val) return undefined
  return allowed.includes(val) ? val : undefined
}

const DB_SSL_MODES = ['disable', 'require', 'no-verify'] as const

export const envConfig = {
  // Database
  databaseUrl: envOrFile('DATABASE_URL'),
  dbHost: env('DB_HOST'),
  dbPort: envInt('DB_PORT'),
  dbUser: env('DB_USER'),
  dbPass: envOrFile('DB_PASS'),
  dbName: env('DB_NAME'),
  dbPoolMax: envInt('DB_POOL_MAX'),
  dbConnectTimeoutMs: envInt('DB_CONNECT_TIMEOUT_MS'),
  dbSslMode: envOneOf('DB_SSL_MODE', DB_SSL_MODES),

  // Server
  port: envInt('PORT') ?? 3000,
  allowedOrigin: env('ALLOWED_ORIGIN'),

  // Lidarr
  lidarrUrl: env('LIDARR_URL'),
  lidarrApiKey: env('LIDARR_API_KEY'),
  skipTlsVerify: envBool('SKIP_TLS_VERIFY'),

  // ListenBrainz
  listenbrainzUsername: env('LISTENBRAINZ_USERNAME'),
  listenbrainzToken: env('LISTENBRAINZ_TOKEN'),

  // Last.fm
  lastfmUsername: env('LASTFM_USERNAME'),
  lastfmApiKey: env('LASTFM_API_KEY'),

  // AI provider
  aiProvider: env('AI_PROVIDER'),
  aiApiKey: env('AI_API_KEY'),
  aiModel: env('AI_MODEL'),
  aiBaseUrl: env('AI_BASE_URL'),

  // Auth
  authToken: env('DIGARR_AUTH_TOKEN') ?? null,

  // Initial user (created on boot if no users exist)
  initialUsername: env('DIGARR_INITIAL_USERNAME'),
  initialPassword: env('DIGARR_INITIAL_PASSWORD'),

  // Webhook (injected into preferences during auto-setup only)
  webhookUrl: env('WEBHOOK_URL'),

  // Encryption (optional - encrypts API keys and tokens at rest in the DB)
  encryptionKey: env('DIGARR_ENCRYPTION_KEY'),
  // Secondary key for rotation. When set, decryptField falls back to this
  // key if the primary key fails. See docs/runbooks/encryption-key-rotation.md.
  encryptionKeyNext: env('DIGARR_ENCRYPTION_KEY_NEXT'),

  // Registration control
  disableRegistration: envBool('DIGARR_DISABLE_REGISTRATION', true),

  // Proxy auth
  proxyAuthEnabled: envBool('PROXY_AUTH_ENABLED'),
  proxyAuthTrustedProxies: env('PROXY_AUTH_TRUSTED_PROXIES'), // comma-separated CIDRs

  // OIDC (fallbacks for DB settings)
  oidcIssuerUrl: env('OIDC_ISSUER_URL'),
  oidcClientId: env('OIDC_CLIENT_ID'),
  oidcClientSecret: env('OIDC_CLIENT_SECRET'),
  oidcScopes: env('OIDC_SCOPES'),
  // Gates email-verified auto-link to existing local users. Only enable when
  // the IdP is single-tenant and trusted; public/multi-tenant issuers can
  // claim arbitrary emails and hijack accounts. See docs/AUTHENTICATION.md.
  oidcTrustEmailVerified: envBool('OIDC_TRUST_EMAIL_VERIFIED'),

  // Deezer OAuth
  deezerAppId: env('DEEZER_APP_ID'),
  deezerAppSecret: env('DEEZER_APP_SECRET'),
} as const

export type EnvConfig = typeof envConfig

/**
 * Validate PROXY_AUTH_TRUSTED_PROXIES at module load. Every CIDR must parse
 * strictly (IPv4 or IPv6) and the unbounded ranges `0.0.0.0/0` and `::/0`
 * are rejected because they disable the proxy-auth trust boundary entirely.
 */
function validateTrustedProxies(): void {
  const raw = envConfig.proxyAuthTrustedProxies
  if (!raw) return
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const cidr of entries) {
    try {
      assertCidr(cidr)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`PROXY_AUTH_TRUSTED_PROXIES entry invalid: ${reason}`)
    }
  }
}

validateTrustedProxies()

/**
 * Build a DATABASE_URL from either the env var directly or individual DB_* vars.
 * Throws if neither is configured.
 */
export function buildDatabaseUrl(): string {
  if (envConfig.databaseUrl) return envConfig.databaseUrl

  const { dbHost, dbPort, dbUser, dbPass, dbName } = envConfig
  if (dbHost && dbUser && dbName) {
    const port = dbPort ?? 5432
    const pass = dbPass ? `:${encodeURIComponent(dbPass)}` : ''
    return `postgresql://${dbUser}${pass}@${dbHost}:${port}/${dbName}`
  }

  throw new Error('DATABASE_URL or DB_HOST + DB_USER + DB_NAME must be set')
}

/** Settings fields that can be sourced from env vars (fallback for null DB values). */
const ENV_OVERRIDE_KEYS = [
  'lidarrUrl',
  'lidarrApiKey',
  // skipTlsVerify is NOT NULL in the DB (defaults false), so null-merge never applies
  'aiProvider',
  'aiApiKey',
  'aiModel',
  'aiBaseUrl',
  'oidcIssuerUrl',
  'oidcClientId',
  'oidcClientSecret',
  'oidcScopes',
] as const satisfies ReadonlyArray<keyof EnvConfig>

export function envSettingsOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {}
  for (const key of ENV_OVERRIDE_KEYS) {
    if (envConfig[key]) overrides[key] = envConfig[key]
  }
  return overrides
}

/** True if env vars contain all required fields to auto-complete setup. */
export function canAutoSetup(): boolean {
  const { aiProvider, aiModel } = envConfig
  // AI provider + model are always required
  if (!aiProvider || !aiModel) return false
  // Lidarr is optional - if not set, runs in discovery-only mode
  return true
}
