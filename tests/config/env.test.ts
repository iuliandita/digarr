// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We need to test the module with different env vars, so we import dynamically
// after setting process.env in each test.

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, val] of Object.entries(vars)) {
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
}

const ENV_KEYS = [
  'DATABASE_URL',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASS',
  'DB_NAME',
  'DB_POOL_MAX',
  'DB_CONNECT_TIMEOUT_MS',
  'DB_SSL_MODE',
  'PORT',
  'ALLOWED_ORIGIN',
  'LIDARR_URL',
  'LIDARR_API_KEY',
  'SKIP_TLS_VERIFY',
  'LISTENBRAINZ_USERNAME',
  'LISTENBRAINZ_TOKEN',
  'LASTFM_USERNAME',
  'LASTFM_API_KEY',
  'AI_PROVIDER',
  'AI_API_KEY',
  'AI_MODEL',
  'AI_BASE_URL',
  'DIGARR_ALLOW_INSECURE_COOKIES',
  'DIGARR_MUSICBRAINZ_URL',
  'DIGARR_MUSICBRAINZ_INTERVAL_MS',
] as const

describe('MusicBrainz operator configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('DIGARR_MUSICBRAINZ_URL', undefined)
    vi.stubEnv('DIGARR_MUSICBRAINZ_INTERVAL_MS', undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('defaults to the public API with a one-second interval', async () => {
    const { envConfig } = await import('@/config/env')
    expect(envConfig.musicbrainzUrl).toBe('https://musicbrainz.org/ws/2')
    expect(envConfig.musicbrainzIntervalMs).toBe(1000)
  })

  it.each(['http', 'https'])(
    'reads a %s mirror at runtime and removes trailing slashes',
    async (scheme) => {
      vi.stubEnv('DIGARR_MUSICBRAINZ_URL', `${scheme}://mirror.example:5000/custom/ws/2///`)
      vi.stubEnv('DIGARR_MUSICBRAINZ_INTERVAL_MS', '0')
      const { envConfig, envSettingsOverrides } = await import('@/config/env')
      expect(envConfig.musicbrainzUrl).toBe(`${scheme}://mirror.example:5000/custom/ws/2`)
      expect(envConfig.musicbrainzIntervalMs).toBe(0)
      expect(envSettingsOverrides()).not.toHaveProperty('musicbrainzUrl')
      expect(envSettingsOverrides()).not.toHaveProperty('musicbrainzIntervalMs')
    },
  )

  it.each([
    'invalid-secret-value',
    '/relative/secret',
    'ftp://mirror.example/secret',
    'https://secret:password@mirror.example/ws/2',
    'https://mirror.example/ws/2?token=secret',
    'https://mirror.example/ws/2#secret',
    'https://mirror.example/ws/2?',
    'https://mirror.example/ws/2#',
  ])('rejects invalid base URL without leaking its value: %s', async (url) => {
    vi.stubEnv('DIGARR_MUSICBRAINZ_URL', url)
    await expect(import('@/config/env')).rejects.toThrow(/^DIGARR_MUSICBRAINZ_URL /)
    await expect(import('@/config/env')).rejects.not.toThrow(/secret|password/)
  })

  it.each(['-1', '1.5', '1e3', '100ms', 'NaN', 'Infinity', ' ', '2147483648', '9007199254740992'])(
    'rejects invalid or overflowing intervals: %s',
    async (interval) => {
      vi.stubEnv('DIGARR_MUSICBRAINZ_INTERVAL_MS', interval)
      await expect(import('@/config/env')).rejects.toThrow(/^DIGARR_MUSICBRAINZ_INTERVAL_MS /)
    },
  )

  it.each(['musicbrainz.org', 'MUSICBRAINZ.ORG.', 'www.musicbrainz.org', 'test.musicbrainz.org.'])(
    'protects the public rate limit for %s',
    async (hostname) => {
      vi.stubEnv('DIGARR_MUSICBRAINZ_URL', `https://${hostname}/ws/2`)
      vi.stubEnv('DIGARR_MUSICBRAINZ_INTERVAL_MS', '999')
      await expect(import('@/config/env')).rejects.toThrow(/at least 1000/)
    },
  )

  it('allows a more conservative public interval', async () => {
    vi.stubEnv('DIGARR_MUSICBRAINZ_INTERVAL_MS', '2000')
    const { envConfig } = await import('@/config/env')
    expect(envConfig.musicbrainzIntervalMs).toBe(2000)
  })
})

describe('buildDatabaseUrl', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    for (const key of ENV_KEYS) delete process.env[key]
  })

  afterEach(() => {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
    // Reset module cache so envConfig re-reads env
    vi.resetModules()
  })

  it('returns DATABASE_URL when set', async () => {
    setEnv({ DATABASE_URL: 'postgresql://a:b@host:5432/mydb' })
    const { buildDatabaseUrl } = await import('@/config/env')
    expect(buildDatabaseUrl()).toBe('postgresql://a:b@host:5432/mydb')
  })

  it('builds URL from individual DB_* vars', async () => {
    setEnv({ DB_HOST: 'myhost', DB_USER: 'usr', DB_PASS: 'pw', DB_NAME: 'testdb', DB_PORT: '5433' })
    const { buildDatabaseUrl } = await import('@/config/env')
    expect(buildDatabaseUrl()).toBe('postgresql://usr:pw@myhost:5433/testdb')
  })

  it('defaults DB_PORT to 5432', async () => {
    setEnv({ DB_HOST: 'myhost', DB_USER: 'usr', DB_NAME: 'testdb' })
    const { buildDatabaseUrl } = await import('@/config/env')
    expect(buildDatabaseUrl()).toBe('postgresql://usr@myhost:5432/testdb')
  })

  it('throws when no database config is provided', async () => {
    const { buildDatabaseUrl } = await import('@/config/env')
    expect(() => buildDatabaseUrl()).toThrow('DATABASE_URL or DB_HOST')
  })

  it('prefers DATABASE_URL over individual vars', async () => {
    setEnv({
      DATABASE_URL: 'postgresql://preferred:pw@host:5432/db',
      DB_HOST: 'other',
      DB_USER: 'other',
      DB_NAME: 'other',
    })
    const { buildDatabaseUrl } = await import('@/config/env')
    expect(buildDatabaseUrl()).toBe('postgresql://preferred:pw@host:5432/db')
  })

  it('parses optional pool and SSL settings', async () => {
    setEnv({
      DATABASE_URL: 'postgresql://a:b@host:5432/mydb',
      DB_POOL_MAX: '12',
      DB_CONNECT_TIMEOUT_MS: '15000',
      DB_SSL_MODE: 'no-verify',
    })
    const { envConfig } = await import('@/config/env')
    expect(envConfig.dbPoolMax).toBe(12)
    expect(envConfig.dbConnectTimeoutMs).toBe(15000)
    expect(envConfig.dbSslMode).toBe('no-verify')
  })

  it('ignores invalid SSL modes', async () => {
    setEnv({
      DATABASE_URL: 'postgresql://a:b@host:5432/mydb',
      DB_SSL_MODE: 'bogus',
    })
    const { envConfig } = await import('@/config/env')
    expect(envConfig.dbSslMode).toBeUndefined()
  })
})

describe('envSettingsOverrides', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    for (const key of ENV_KEYS) delete process.env[key]
  })

  afterEach(() => {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
    vi.resetModules()
  })

  it('returns empty object when no service env vars are set', async () => {
    const { envSettingsOverrides } = await import('@/config/env')
    expect(envSettingsOverrides()).toEqual({})
  })

  it('includes set env vars in overrides', async () => {
    setEnv({ LIDARR_URL: 'http://lidarr:8686', AI_PROVIDER: 'openai' })
    const { envSettingsOverrides } = await import('@/config/env')
    const overrides = envSettingsOverrides()
    expect(overrides.lidarrUrl).toBe('http://lidarr:8686')
    expect(overrides.aiProvider).toBe('openai')
    expect(overrides).not.toHaveProperty('lidarrApiKey')
  })
})

describe('allowInsecureCookies', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    for (const key of ENV_KEYS) delete process.env[key]
  })

  afterEach(() => {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
    vi.resetModules()
  })

  it('parses DIGARR_ALLOW_INSECURE_COOKIES=true', async () => {
    setEnv({ DIGARR_ALLOW_INSECURE_COOKIES: 'true' })
    const { envConfig } = await import('@/config/env')
    expect(envConfig.allowInsecureCookies).toBe(true)
  })

  it('parses DIGARR_ALLOW_INSECURE_COOKIES=false', async () => {
    setEnv({ DIGARR_ALLOW_INSECURE_COOKIES: 'false' })
    const { envConfig } = await import('@/config/env')
    expect(envConfig.allowInsecureCookies).toBe(false)
  })

  it('defaults to false when unset', async () => {
    const { envConfig } = await import('@/config/env')
    expect(envConfig.allowInsecureCookies).toBe(false)
  })
})

describe('canAutoSetup', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    for (const key of ENV_KEYS) delete process.env[key]
  })

  afterEach(() => {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
    vi.resetModules()
  })

  it('returns true when AI vars are set', async () => {
    setEnv({
      LIDARR_URL: 'http://lidarr:8686',
      LIDARR_API_KEY: 'key',
      AI_PROVIDER: 'openai',
      AI_MODEL: 'gpt-4o-mini',
    })
    const { canAutoSetup } = await import('@/config/env')
    expect(canAutoSetup()).toBe(true)
  })

  it('returns true when Lidarr is missing but AI is set', async () => {
    setEnv({
      AI_PROVIDER: 'openai',
      AI_MODEL: 'gpt-4o-mini',
    })
    const { canAutoSetup } = await import('@/config/env')
    expect(canAutoSetup()).toBe(true)
  })

  it('returns false when AI vars are missing', async () => {
    setEnv({
      LIDARR_URL: 'http://lidarr:8686',
      LIDARR_API_KEY: 'key',
    })
    const { canAutoSetup } = await import('@/config/env')
    expect(canAutoSetup()).toBe(false)
  })

  it('returns false when nothing is set', async () => {
    const { canAutoSetup } = await import('@/config/env')
    expect(canAutoSetup()).toBe(false)
  })
})
