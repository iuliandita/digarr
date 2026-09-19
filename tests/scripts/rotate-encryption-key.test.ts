// @vitest-environment node

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { COLUMN_SITES, NESTED_SITES } from '../../scripts/rotation-sites'
import {
  decryptChannelSecrets,
  encryptChannelSecrets,
  encryptField,
  initEncryption,
  SENSITIVE_OAUTH,
  SENSITIVE_PREFERENCES,
  SENSITIVE_SETTINGS,
  SENSITIVE_USER_CONNECTIONS,
} from '../../src/core/crypto'
import type { NotificationChannel } from '../../src/core/notifications/types'

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

const OLD_KEY = 'rotation-old-test-key'
const CURRENT_KEY = 'rotation-current-test-key'

async function createDatabase(dataDir: string): Promise<void> {
  const client = new PGlite(dataDir)
  try {
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
          CREATE TABLE targets (id integer PRIMARY KEY, config jsonb);
        `)
  } finally {
    await client.close()
  }
}

function runRotation(dataDir: string, nextKey = '') {
  return spawnSync('bun', ['scripts/rotate-encryption-key.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: dataDir,
      DATABASE_URL: '',
      DB_HOST: '',
      DB_USER: '',
      DB_NAME: '',
      DIGARR_ENCRYPTION_KEY: CURRENT_KEY,
      DIGARR_ENCRYPTION_KEY_NEXT: nextKey,
    },
    encoding: 'utf8',
    timeout: 30_000,
  })
}

async function readPreferences(
  dataDir: string,
): Promise<Array<{ id: number; preferences: Record<string, unknown> | null }>> {
  const client = new PGlite(dataDir)
  try {
    return (
      await client.query<{ id: number; preferences: Record<string, unknown> | null }>(
        'SELECT id, preferences FROM settings ORDER BY id',
      )
    ).rows
  } finally {
    await client.close()
  }
}

describe('encryption-key rotation coverage', () => {
  afterEach(() => initEncryption(undefined))
  it('covers every encrypted scalar column', () => {
    const actual = COLUMN_SITES.map(({ table, column }) => `${table}.${column}`).sort()
    const expected = [
      ...SENSITIVE_SETTINGS.map((column) => `settings.${snakeCase(column)}`),
      ...SENSITIVE_USER_CONNECTIONS.map((column) => `users.${snakeCase(column)}`),
      ...SENSITIVE_OAUTH.map((column) => `oauth_tokens.${snakeCase(column)}`),
    ].sort()

    expect(actual).toEqual(expected)
    expect(actual.some((site) => site.startsWith('oidc_tokens.'))).toBe(false)
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
    try {
      await createDatabase(dataDir)
      const client = new PGlite(dataDir)
      try {
        await client.exec("INSERT INTO settings (id, ai_api_key) VALUES (1, 'enc:v1:malformed')")
      } finally {
        await client.close()
      }

      const result = runRotation(dataDir)

      expect(result.error).toBeUndefined()
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('rotation incomplete: 1 encrypted values')
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  }, 35_000)
  it('rotates every channel secret and preserves preferences through a primary-only second pass', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'digarr-rotation-'))
    const channels: NotificationChannel[] = [
      {
        id: 'enc:v1:metadata-id',
        type: 'webhook',
        enabled: true,
        events: ['batch_complete'],
        url: 'https://example.test/private-hook',
      },
      {
        id: 't',
        type: 'telegram',
        enabled: false,
        events: ['digest'],
        botToken: 'private-bot-token',
        chatId: 'enc:v1:metadata-chat',
      },
      {
        id: 'n',
        type: 'ntfy',
        enabled: true,
        events: ['digest'],
        server: 'https://ntfy.test',
        topic: 'enc:v1:metadata-topic',
        token: 'private-ntfy-token',
      },
      {
        id: 'a',
        type: 'apprise',
        enabled: true,
        events: ['digest'],
        endpoint: 'https://apprise.test',
        urls: 'discord://private-token@id',
      },
    ]
    initEncryption(OLD_KEY)
    const encrypted = encryptChannelSecrets(channels)
    initEncryption(CURRENT_KEY)
    const currentChannel = encryptChannelSecrets([
      { ...channels[1], id: 'current' } as NotificationChannel,
    ])[0]
    if (!currentChannel) throw new Error('Missing current-key channel fixture')
    const plaintextChannel: NotificationChannel = {
      id: 'plain',
      type: 'ntfy',
      enabled: true,
      events: ['digest'],
      server: 'https://ntfy.test',
      topic: 'enc:v1:plaintext-topic',
      token: 'plaintext-token',
    }
    const absentChannel: NotificationChannel = {
      id: 'absent',
      type: 'ntfy',
      enabled: false,
      events: [],
      server: 'https://ntfy.test',
      topic: 'other',
    }
    const metadata = { theme: 'dark', custom: { enabled: true, values: [1, 'preserved'] } }
    const preferences = {
      ...metadata,
      channels: [...encrypted, currentChannel, plaintextChannel, absentChannel],
    }
    try {
      await createDatabase(dataDir)
      const client = new PGlite(dataDir)
      try {
        await client.query(
          'INSERT INTO settings (id, preferences) VALUES (1, $1), (2, $2), (3, $3), (4, NULL)',
          [preferences, metadata, { channels: [] }],
        )
      } finally {
        await client.close()
      }
      for (const nextKey of [OLD_KEY, '']) {
        const result = runRotation(dataDir, nextKey)
        expect(result.error).toBeUndefined()
        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout).toContain(
          'settings.preferences.channels ... 4 scanned, 1 rewritten, 0 failures',
        )
        initEncryption(CURRENT_KEY)
        const rows = await readPreferences(dataDir)
        const row = rows[0]
        if (!row) throw new Error('Missing settings row after rotation')
        const rotated = row.preferences as typeof preferences
        const expected = {
          ...metadata,
          channels: [
            ...channels,
            { ...channels[1], id: 'current' },
            plaintextChannel,
            absentChannel,
          ],
        }
        const decrypted = decryptChannelSecrets(rotated.channels)
        expect({ ...rotated, channels: decrypted }).toEqual(expected)
        expect(rotated.channels[0]).not.toEqual(encrypted[0])
        expect(rows.slice(1)).toEqual([
          { id: 2, preferences: metadata },
          { id: 3, preferences: { channels: [] } },
          { id: 4, preferences: null },
        ])
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  }, 70_000)

  it.each(['malformed', 'wrong-key'])(
    'fails safely for %s channel ciphertext',
    async (kind) => {
      const dataDir = mkdtempSync(join(tmpdir(), 'digarr-rotation-'))
      const secret = 'private-unreadable-token'
      initEncryption('unavailable-test-key')
      const ciphertext = kind === 'malformed' ? `enc:v1:${secret}` : encryptField(secret)
      const preferences = {
        channels: [{ id: 't', type: 'telegram', botToken: ciphertext, chatId: '123' }],
      }
      try {
        await createDatabase(dataDir)
        const client = new PGlite(dataDir)
        try {
          await client.query('INSERT INTO settings (id, preferences) VALUES (1, $1)', [preferences])
        } finally {
          await client.close()
        }
        const result = runRotation(dataDir, OLD_KEY)
        expect(result.error).toBeUndefined()
        expect(result.status).toBe(1)
        expect(result.stdout).toContain(
          'settings.preferences.channels ... 1 scanned, 0 rewritten, 1 failures',
        )
        expect(result.stderr).toContain('rotation incomplete: 1 encrypted values')
        expect(result.stdout + result.stderr).not.toContain(secret)
        expect(result.stdout + result.stderr).not.toContain(ciphertext)
        expect(await readPreferences(dataDir)).toEqual([{ id: 1, preferences }])
      } finally {
        rmSync(dataDir, { recursive: true, force: true })
      }
    },
    35_000,
  )
})
