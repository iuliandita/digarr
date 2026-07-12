// @vitest-environment node

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { COLUMN_SITES, NESTED_SITES } from '../../scripts/rotation-sites'
import {
  SENSITIVE_OAUTH,
  SENSITIVE_OIDC,
  SENSITIVE_PREFERENCES,
  SENSITIVE_SETTINGS,
  SENSITIVE_USER_CONNECTIONS,
} from '../../src/core/crypto'

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

describe('encryption-key rotation coverage', () => {
  it('covers every encrypted scalar column', () => {
    const actual = COLUMN_SITES.map(({ table, column }) => `${table}.${column}`).sort()
    const expected = [
      ...SENSITIVE_SETTINGS.map((column) => `settings.${snakeCase(column)}`),
      ...SENSITIVE_USER_CONNECTIONS.map((column) => `users.${snakeCase(column)}`),
      ...SENSITIVE_OAUTH.map((column) => `oauth_tokens.${snakeCase(column)}`),
      ...SENSITIVE_OIDC.map((column) => `oidc_tokens.${snakeCase(column)}`),
    ].sort()

    expect(actual).toEqual(expected)
  })

  it('covers every encrypted preference path', () => {
    expect(NESTED_SITES).toEqual(
      SENSITIVE_PREFERENCES.map((key) => ({
        table: 'settings',
        column: 'preferences',
        path: [key],
      })),
    )
  })

  it('exits nonzero when encrypted ciphertext cannot be rotated', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'digarr-rotation-'))
    const client = new PGlite(dataDir)
    await client.exec(`
      CREATE TABLE settings (
        id integer PRIMARY KEY,
        lidarr_api_key text,
        ai_api_key text,
        audiodb_api_key text,
        oidc_client_secret text,
        tidal_client_secret text,
        preferences jsonb
      );
      CREATE TABLE users (
        id integer PRIMARY KEY,
        listenbrainz_token text,
        lastfm_api_key text,
        plex_token text,
        jellyfin_api_key text,
        emby_api_key text,
        discogs_token text,
        subsonic_password text
      );
      CREATE TABLE oauth_tokens (
        id integer PRIMARY KEY,
        access_token text,
        refresh_token text,
        client_secret text
      );
      CREATE TABLE oidc_tokens (
        id integer PRIMARY KEY,
        access_token text,
        refresh_token text,
        id_token text
      );
      CREATE TABLE targets (id integer PRIMARY KEY, config jsonb);
      INSERT INTO settings (id, ai_api_key) VALUES (1, 'enc:v1:malformed');
    `)
    await client.close()

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DB_PATH: dataDir,
      DATABASE_URL: '',
      DB_HOST: '',
      DB_USER: '',
      DB_NAME: '',
      DIGARR_ENCRYPTION_KEY: 'test-key-please-do-not-use-in-prod',
      DIGARR_ENCRYPTION_KEY_NEXT: '',
    }

    const result = spawnSync('bun', ['scripts/rotate-encryption-key.ts'], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      timeout: 15_000,
    })
    rmSync(dataDir, { recursive: true, force: true })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('rotation incomplete: 1 encrypted values')
  }, 20_000)
})
