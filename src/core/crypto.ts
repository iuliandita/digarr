import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import type { NotificationChannel } from '@/core/notifications/types'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const PREFIX = 'enc:v1:'

let derivedKey: Buffer | null = null
let legacyKey: Buffer | null = null
let nextKey: Buffer | null = null
let nextLegacyKey: Buffer | null = null

function deriveHkdfKey(input: string): Buffer {
  return Buffer.from(hkdfSync('sha256', input, '', 'digarr-field-encryption', 32))
}

/**
 * Initialize encryption with a key string. Call once at startup.
 *
 * `nextKeyInput` enables dual-key mode for rotation: during rotation the
 * operator sets a second key so decrypts fall through to it, then swaps the
 * roles across two deploys with a re-encryption pass in between. See
 * docs/runbooks/encryption-key-rotation.md.
 */
export function initEncryption(
  keyInput: string | undefined,
  nextKeyInput?: string | undefined,
): void {
  if (!keyInput) {
    derivedKey = null
    legacyKey = null
    nextKey = null
    nextLegacyKey = null
    return
  }
  // HKDF-derived key (current)
  derivedKey = deriveHkdfKey(keyInput)
  // SHA-256 key (legacy - kept for decrypting pre-migration values)
  legacyKey = createHash('sha256').update(keyInput).digest()
  // Optional second HKDF key for rotation. decryptField tries primary first
  // and falls back to this key on auth-tag failure.
  nextKey = nextKeyInput ? deriveHkdfKey(nextKeyInput) : null
  nextLegacyKey = nextKeyInput ? createHash('sha256').update(nextKeyInput).digest() : null
}

export function isEncryptionEnabled(): boolean {
  return derivedKey !== null
}

/**
 * Returns a SHA-256 hash of the first 8 bytes of the derived encryption key.
 * Used to detect key mismatches during backup restore without exposing the key.
 */
export function getKeyFingerprint(): string | null {
  if (!derivedKey) return null
  const slice = derivedKey.subarray(0, 8)
  const hash = createHash('sha256').update(slice).digest('hex')
  return `sha256:${hash}`
}

function decryptWithKey(ivStr: string, encStr: string, tagStr: string, key: Buffer): string {
  const iv = Buffer.from(ivStr, 'base64')
  const encrypted = Buffer.from(encStr, 'base64')
  const tag = Buffer.from(tagStr, 'base64')

  if (tag.byteLength !== 16) throw new Error('Invalid auth tag length')
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 })
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

/** Encrypt a string value. Returns the original if encryption is disabled or value is null. */
export function encryptField(value: string | null | undefined): typeof value {
  if (value == null || !derivedKey) return value
  if (value.startsWith(PREFIX)) return value // already encrypted

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${PREFIX}${iv.toString('base64')}.${encrypted.toString('base64')}.${tag.toString('base64')}`
}

/** Decrypt a string value. Returns plaintext as-is if not encrypted. Throws on wrong key. */
export function decryptField(value: string | null | undefined): typeof value {
  if (value == null) return value
  if (!value.startsWith(PREFIX)) return value // plaintext, not yet encrypted
  if (!derivedKey) {
    console.warn('[crypto] Encrypted value found but no encryption key configured')
    return value
  }

  const [ivStr, encStr, tagStr] = value.slice(PREFIX.length).split('.')
  if (!ivStr || !encStr || !tagStr) return value // malformed

  // Try both HKDF keys, then both legacy SHA-256 derivations.
  // AES-GCM auth-tag verification is cheap so trial decryption is fine.
  try {
    return decryptWithKey(ivStr, encStr, tagStr, derivedKey)
  } catch {
    // fall through
  }
  if (nextKey) {
    try {
      return decryptWithKey(ivStr, encStr, tagStr, nextKey)
    } catch {
      // fall through
    }
  }
  if (legacyKey) {
    try {
      return decryptWithKey(ivStr, encStr, tagStr, legacyKey)
    } catch {
      // fall through
    }
  }
  if (nextLegacyKey) {
    try {
      return decryptWithKey(ivStr, encStr, tagStr, nextLegacyKey)
    } catch {
      // fall through
    }
  }
  throw new Error('Decryption failed - check DIGARR_ENCRYPTION_KEY')
}

/** Encrypt specific string fields in an object. */
export function encryptFields<T extends object>(obj: T, fields: readonly string[]): T {
  if (!derivedKey) return obj
  const copy = { ...obj } as Record<string, unknown>
  for (const f of fields) {
    if (typeof copy[f] === 'string') {
      copy[f] = encryptField(copy[f] as string)
    }
  }
  return copy as T
}

/** Decrypt specific string fields in an object. */
export function decryptFields<T extends object>(obj: T, fields: readonly string[]): T {
  if (!derivedKey) return obj
  const copy = { ...obj } as Record<string, unknown>
  for (const f of fields) {
    if (typeof copy[f] === 'string') {
      copy[f] = decryptField(copy[f] as string)
    }
  }
  return copy as T
}

// Sensitive field lists per table
export const SENSITIVE_SETTINGS = [
  'lidarrApiKey',
  'aiApiKey',
  'audiodbApiKey',
  'oidcClientSecret',
  'tidalClientSecret',
] as const
export const SENSITIVE_OAUTH = ['accessToken', 'refreshToken', 'clientSecret'] as const
export const SENSITIVE_PREFERENCES = ['fanartApiKey'] as const

// Notification channels store secrets in array-nested, per-type fields that the
// flat encrypt/decryptFields helpers cannot reach. These walkers apply
// field-level crypto per channel type. webhook has no secret field.
const CHANNEL_SECRET_FIELDS: Record<string, readonly string[]> = {
  telegram: ['botToken'],
  ntfy: ['token'],
  apprise: ['urls'],
  webhook: [],
}

function transformChannelSecrets(
  channels: NotificationChannel[],
  fn: (value: string) => string,
): NotificationChannel[] {
  return channels.map((channel) => {
    const fields = CHANNEL_SECRET_FIELDS[channel.type] ?? []
    const copy = { ...channel } as Record<string, unknown>
    for (const f of fields) {
      const val = copy[f]
      if (typeof val === 'string' && val) {
        copy[f] = fn(val)
      }
    }
    return copy as NotificationChannel
  })
}

/** Encrypt per-type secret fields in notification channels. No-op if encryption disabled. */
export function encryptChannelSecrets(channels: NotificationChannel[]): NotificationChannel[] {
  if (!isEncryptionEnabled()) return channels
  return transformChannelSecrets(channels, (v) => encryptField(v) as string)
}

/** Decrypt per-type secret fields in notification channels. No-op if encryption disabled. */
export function decryptChannelSecrets(channels: NotificationChannel[]): NotificationChannel[] {
  if (!isEncryptionEnabled()) return channels
  return transformChannelSecrets(channels, (v) => decryptField(v) as string)
}

/** Replace per-type secret fields with a masked placeholder. Always runs. */
export function maskChannelSecrets(channels: NotificationChannel[]): NotificationChannel[] {
  return transformChannelSecrets(channels, () => '***')
}

/**
 * Restore masked ('***') channel secrets from a previously-stored channel of the
 * same id, so a save/test that echoes back masked placeholders keeps the stored
 * (encrypted) secret. If the previous channel is missing or has a different type
 * (id reused across a type change, or a genuinely new channel that still carries
 * a literal '***'), the field is dropped instead of persisting a broken secret.
 * Returns new objects; does not mutate the input.
 */
export function restoreMaskedChannelSecrets(
  incoming: NotificationChannel[],
  prevById: Map<string, NotificationChannel>,
): NotificationChannel[] {
  return incoming.map((channel) => {
    const fields = CHANNEL_SECRET_FIELDS[channel.type] ?? []
    const copy = { ...channel } as Record<string, unknown>
    if (fields.length === 0) return copy as NotificationChannel
    const prev = prevById.get(channel.id)
    const prevFields =
      prev && prev.type === channel.type ? (prev as unknown as Record<string, unknown>) : undefined
    for (const f of fields) {
      if (copy[f] === '***') {
        if (prevFields && typeof prevFields[f] === 'string' && prevFields[f]) {
          copy[f] = prevFields[f]
        } else {
          delete copy[f]
        }
      }
    }
    return copy as NotificationChannel
  })
}
export const SENSITIVE_USER_CONNECTIONS = [
  'listenbrainzToken',
  'lastfmApiKey',
  'plexToken',
  'jellyfinApiKey',
  'embyApiKey',
  'discogsToken',
  'subsonicPassword',
] as const
export const SENSITIVE_TARGET_CONFIG = ['apiKey', 'password', 'token', 'secret'] as const
