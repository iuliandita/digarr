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
// field-level crypto per channel type. Two classes of field:
//  - full secrets (CHANNEL_SECRET_FIELDS): encrypted at rest, masked to '***'.
//  - url secrets (CHANNEL_URL_FIELDS): encrypted at rest, but only PARTIALLY
//    masked (host + path kept, secret tail/query hidden) because the URL also
//    identifies the destination and the operator needs to recognize it.
const CHANNEL_SECRET_FIELDS: Record<string, readonly string[]> = {
  telegram: ['botToken'],
  ntfy: ['token'],
  apprise: ['urls'],
}

const CHANNEL_URL_FIELDS: Record<string, readonly string[]> = {
  webhook: ['url'],
}

const MASK = '***'

function encryptedFieldsFor(type: string): readonly string[] {
  return [...(CHANNEL_SECRET_FIELDS[type] ?? []), ...(CHANNEL_URL_FIELDS[type] ?? [])]
}

/**
 * Partially mask a webhook URL for API display: keep the scheme, host, and path
 * structure so the operator can recognize the destination, but replace the last
 * path segment (where Discord/Slack carry the token) and every query-param value
 * with `***`. Unparseable input is fully masked.
 */
export function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url)
    const segments = u.pathname.split('/')
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i]) {
        segments[i] = MASK
        break
      }
    }
    u.pathname = segments.join('/')
    for (const key of [...u.searchParams.keys()]) {
      u.searchParams.set(key, MASK)
    }
    return u.toString()
  } catch {
    return MASK
  }
}

function transformChannelFields(
  channels: NotificationChannel[],
  fn: (value: string) => string,
): NotificationChannel[] {
  return channels.map((channel) => {
    const copy = { ...channel } as Record<string, unknown>
    for (const f of encryptedFieldsFor(channel.type)) {
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
  return transformChannelFields(channels, (v) => encryptField(v) as string)
}

/** Decrypt per-type secret fields in notification channels. No-op if encryption disabled. */
export function decryptChannelSecrets(channels: NotificationChannel[]): NotificationChannel[] {
  if (!isEncryptionEnabled()) return channels
  return transformChannelFields(channels, (v) => decryptField(v) as string)
}

/**
 * Mask channel secrets for API display. Full-secret fields become '***'; url
 * fields are decrypted (server-side only) and partially masked so the host stays
 * visible while the secret tail is hidden. Always runs.
 */
export function maskChannelSecrets(channels: NotificationChannel[]): NotificationChannel[] {
  return channels.map((channel) => {
    const copy = { ...channel } as Record<string, unknown>
    for (const f of CHANNEL_SECRET_FIELDS[channel.type] ?? []) {
      if (typeof copy[f] === 'string' && copy[f]) copy[f] = MASK
    }
    for (const f of CHANNEL_URL_FIELDS[channel.type] ?? []) {
      const val = copy[f]
      if (typeof val === 'string' && val) copy[f] = maskWebhookUrl(decryptField(val) as string)
    }
    return copy as NotificationChannel
  })
}

/**
 * Restore masked channel secrets from a previously-stored channel of the same id,
 * so a save/test that echoes back masked placeholders keeps the stored (encrypted)
 * value. Full secrets restore on the '***' sentinel (dropped if there is no prior
 * channel of the same type, to avoid persisting a broken secret). Url fields
 * restore when the submitted url still equals the mask of the stored url (i.e. the
 * operator did not edit it). Returns new objects; does not mutate the input.
 */
export function restoreMaskedChannelSecrets(
  incoming: NotificationChannel[],
  prevById: Map<string, NotificationChannel>,
): NotificationChannel[] {
  return incoming.map((channel) => {
    const copy = { ...channel } as Record<string, unknown>
    const secretFields = CHANNEL_SECRET_FIELDS[channel.type] ?? []
    const urlFields = CHANNEL_URL_FIELDS[channel.type] ?? []
    if (secretFields.length === 0 && urlFields.length === 0) return copy as NotificationChannel
    const prev = prevById.get(channel.id)
    const prevFields =
      prev && prev.type === channel.type ? (prev as unknown as Record<string, unknown>) : undefined
    for (const f of secretFields) {
      if (copy[f] === MASK) {
        if (prevFields && typeof prevFields[f] === 'string' && prevFields[f]) {
          copy[f] = prevFields[f]
        } else {
          delete copy[f]
        }
      }
    }
    for (const f of urlFields) {
      const prevVal = prevFields?.[f]
      if (
        typeof copy[f] === 'string' &&
        typeof prevVal === 'string' &&
        prevVal &&
        copy[f] === maskWebhookUrl(decryptField(prevVal) as string)
      ) {
        copy[f] = prevVal
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
