import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const PREFIX = 'enc:v1:'

let derivedKey: Buffer | null = null
let legacyKey: Buffer | null = null

/** Initialize encryption with a key string. Call once at startup. */
export function initEncryption(keyInput: string | undefined): void {
  if (!keyInput) {
    derivedKey = null
    legacyKey = null
    return
  }
  // HKDF-derived key (current)
  derivedKey = Buffer.from(hkdfSync('sha256', keyInput, '', 'digarr-field-encryption', 32))
  // SHA-256 key (legacy -- kept for decrypting pre-migration values)
  legacyKey = createHash('sha256').update(keyInput).digest()
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

  // Try HKDF key first, then fall back to legacy SHA-256 key for pre-migration values
  try {
    return decryptWithKey(ivStr, encStr, tagStr, derivedKey)
  } catch {
    if (legacyKey) {
      try {
        return decryptWithKey(ivStr, encStr, tagStr, legacyKey)
      } catch {
        // Both keys failed
      }
    }
    throw new Error('Decryption failed -- check DIGARR_ENCRYPTION_KEY')
  }
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
export const SENSITIVE_SETTINGS = ['lidarrApiKey', 'aiApiKey', 'oidcClientSecret'] as const
export const SENSITIVE_OAUTH = ['accessToken', 'refreshToken', 'clientSecret'] as const
export const SENSITIVE_USER_CONNECTIONS = [
  'listenbrainzToken',
  'lastfmApiKey',
  'plexToken',
  'jellyfinApiKey',
  'embyApiKey',
  'discogsToken',
] as const
export const SENSITIVE_TARGET_CONFIG = ['apiKey', 'password', 'token', 'secret'] as const
