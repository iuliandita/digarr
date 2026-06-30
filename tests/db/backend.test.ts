import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PG_KEYS = ['DATABASE_URL', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASS', 'DB_NAME', 'DB_PATH']
function clearDbEnv() {
  for (const k of PG_KEYS) delete process.env[k]
}
async function load() {
  vi.resetModules() // envConfig + backend resolve env at module load
  return import('@/db/backend')
}

describe('resolveDbBackend', () => {
  beforeEach(clearDbEnv)
  afterEach(clearDbEnv)

  it('uses postgres when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/d'
    expect((await load()).resolveDbBackend()).toBe('postgres')
  })
  it('uses postgres when DB_HOST + DB_USER + DB_NAME are set', async () => {
    process.env.DB_HOST = 'pg'
    process.env.DB_USER = 'digarr'
    process.env.DB_NAME = 'digarr'
    expect((await load()).resolveDbBackend()).toBe('postgres')
  })
  it('falls back to pglite when no postgres vars are set', async () => {
    expect((await load()).resolveDbBackend()).toBe('pglite')
  })
  it('stays pglite when DB_HOST is set but DB_NAME missing', async () => {
    process.env.DB_HOST = 'pg'
    process.env.DB_USER = 'digarr'
    expect((await load()).resolveDbBackend()).toBe('pglite')
  })
  it('getPgliteDataDir defaults to <cwd>/data and honors DB_PATH', async () => {
    expect((await load()).getPgliteDataDir().endsWith('/data')).toBe(true)
    vi.resetModules()
    process.env.DB_PATH = '/var/lib/digarr'
    expect((await import('@/db/backend')).getPgliteDataDir()).toBe('/var/lib/digarr')
  })
})
