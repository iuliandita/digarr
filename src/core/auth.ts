import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import PQueue from 'p-queue'

const SCRYPT_KEYLEN = 64
const SCRYPT_COST = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options?: ScryptOptions,
) => Promise<Buffer>
// Each current-cost KDF uses 128 MiB; serialize them to leave memory for the server.
const passwordQueue = new PQueue({ concurrency: 1 })

/** Returns `salt:hash` format. Works in both Bun and Node.js. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = await passwordQueue.add(() =>
    scryptAsync(password, salt, SCRYPT_KEYLEN, SCRYPT_COST),
  )
  return `${salt}:${hash.toString('hex')}`
}

/** Timing-safe comparison against a stored `salt:hash` string. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  if (expected.byteLength !== SCRYPT_KEYLEN) return false
  return passwordQueue.add(async () => {
    const computed = await scryptAsync(password, salt, SCRYPT_KEYLEN, SCRYPT_COST)
    if (timingSafeEqual(computed, expected)) return true
    // Pre-upgrade hashes have the same format and no cost marker.
    const legacy = await scryptAsync(password, salt, SCRYPT_KEYLEN)
    return timingSafeEqual(legacy, expected)
  })
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}
