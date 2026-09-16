import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import * as dns from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Configuration } from 'openid-client'
import * as oidcClient from 'openid-client'
import {
  errMsg,
  formatUrlHostname,
  getLookupHostname,
  isPrivateIp,
  normalizeIp,
} from '@/core/validation'

const ipPinningFetch: oidcClient.CustomFetch = async (url, options) => {
  const parsedUrl = new URL(url)
  const hostname = getLookupHostname(parsedUrl)
  const { address } = await dns.lookup(hostname)
  if (isPrivateIp(address)) {
    throw new Error('OIDC issuer resolves to a private/internal IP')
  }

  const headers = new Headers(options.headers)
  const init = { ...options, headers } as unknown as RequestInit & {
    tls?: { serverName: string }
  }
  if (address !== hostname) {
    const pinnedUrl = new URL(url)
    pinnedUrl.hostname = formatUrlHostname(address)
    headers.set('Host', parsedUrl.host)
    const normalizedHostname = normalizeIp(parsedUrl.hostname)
    if (parsedUrl.protocol === 'https:' && isIP(normalizedHostname) === 0) {
      init.tls = { serverName: normalizedHostname }
    }
    return fetch(pinnedUrl.toString(), init)
  }

  return fetch(url, init)
}

export interface OidcConfig {
  issuerUrl: string
  clientId: string
  clientSecret?: string
  scopes: string
}

interface PendingAuth {
  nonce: string
  codeVerifier: string
  redirectUri: string
  createdAt: number
  browserBindingHash: Buffer
  purpose: OidcAuthPurpose
}

export type OidcAuthPurpose =
  | Readonly<{ kind: 'login' }>
  | Readonly<{
      kind: 'link'
      userId: number
      sessionHash: string
      passwordFingerprint: string
    }>

export interface OidcUserClaims {
  sub: string
  email?: string
  emailVerified?: boolean
  preferredUsername?: string
  name?: string
}

export interface CallbackResult {
  claims: OidcUserClaims
  purpose: OidcAuthPurpose
}

export const PENDING_AUTH_TTL_MS = 10 * 60 * 1000 // 10 minutes
const DEFAULT_MAX_PENDING_AUTHS = 1_000

/** Thrown when the pending-transaction map is full, bounding login-state memory. */
export class OidcPendingCapacityError extends Error {
  constructor() {
    super('OIDC login capacity reached')
    this.name = 'OidcPendingCapacityError'
  }
}

export class OidcCallbackError extends Error {
  readonly purpose: OidcAuthPurpose

  constructor(purpose: OidcAuthPurpose, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'OidcCallbackError'
    this.purpose = purpose
  }
}

function bindingHash(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export interface OidcServiceOptions {
  maxPendingAuths?: number
  now?: () => number
}

export class OidcService {
  private config: OidcConfig
  private pendingAuths = new Map<string, PendingAuth>()
  private discoveryConfig: Configuration | null = null
  private readonly maxPendingAuths: number
  private readonly now: () => number

  constructor(config: OidcConfig, options: OidcServiceOptions = {}) {
    if (!config.issuerUrl) throw new Error('issuerUrl is required')
    if (!config.clientId) throw new Error('clientId is required')
    this.config = config
    this.maxPendingAuths = options.maxPendingAuths ?? DEFAULT_MAX_PENDING_AUTHS
    this.now = options.now ?? (() => Date.now())
  }

  private async getDiscovery(): Promise<Configuration> {
    if (this.discoveryConfig) return this.discoveryConfig

    this.discoveryConfig = await oidcClient.discovery(
      new URL(this.config.issuerUrl),
      this.config.clientId,
      this.config.clientSecret,
      undefined,
      { [oidcClient.customFetch]: ipPinningFetch },
    )
    return this.discoveryConfig
  }

  /** Reset cached discovery config (e.g. when OIDC settings change). */
  resetDiscovery(): void {
    this.discoveryConfig = null
  }

  /** Verify the issuer is reachable and returns a valid OIDC discovery document. */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.getDiscovery()
      return { success: true, message: 'OIDC discovery successful' }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  async getAuthorizationUrl(
    redirectUri: string,
    purpose: OidcAuthPurpose,
  ): Promise<{ url: string; state: string; browserBinding: string }> {
    this.cleanupPendingAuths()
    if (this.pendingAuths.size >= this.maxPendingAuths) throw new OidcPendingCapacityError()

    const config = await this.getDiscovery()

    const state = oidcClient.randomState()
    const nonce = oidcClient.randomNonce()
    const codeVerifier = oidcClient.randomPKCECodeVerifier()
    const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier)
    const browserBinding = randomBytes(32).toString('base64url')

    this.pendingAuths.set(state, {
      nonce,
      codeVerifier,
      redirectUri,
      createdAt: this.now(),
      browserBindingHash: bindingHash(browserBinding),
      purpose:
        purpose.kind === 'login'
          ? Object.freeze({ kind: 'login' })
          : Object.freeze({
              kind: 'link',
              userId: purpose.userId,
              sessionHash: purpose.sessionHash,
              passwordFingerprint: purpose.passwordFingerprint,
            }),
    })

    const url = oidcClient.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: this.config.scopes,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    return { url: url.href, state, browserBinding }
  }

  async handleCallback(callbackUrl: URL, browserBinding?: string): Promise<CallbackResult> {
    this.cleanupPendingAuths()

    const state = callbackUrl.searchParams.get('state')
    if (!state) throw new Error('Missing state parameter')

    // One-time consumption: retrieve and delete before any validation so a
    // failed attempt (wrong/absent binding) cannot be replayed against a
    // now-known-good binding.
    const pending = this.pendingAuths.get(state)
    this.pendingAuths.delete(state)

    if (!pending) {
      throw new Error('Unknown, expired, or invalid OIDC transaction')
    }

    if (
      this.now() - pending.createdAt > PENDING_AUTH_TTL_MS ||
      !this.bindingMatches(browserBinding, pending.browserBindingHash)
    ) {
      throw new OidcCallbackError(pending.purpose, 'Unknown, expired, or invalid OIDC transaction')
    }

    let idClaims: ReturnType<
      Awaited<ReturnType<typeof oidcClient.authorizationCodeGrant>>['claims']
    >
    try {
      const config = await this.getDiscovery()
      const tokens = await oidcClient.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: state,
        expectedNonce: pending.nonce,
      })
      idClaims = tokens.claims()
      if (!idClaims) throw new Error('No ID token claims in OIDC response')
    } catch (error) {
      throw new OidcCallbackError(pending.purpose, errMsg(error), error)
    }

    return {
      purpose: pending.purpose,
      claims: {
        sub: idClaims.sub,
        email: idClaims.email as string | undefined,
        emailVerified: idClaims.email_verified as boolean | undefined,
        preferredUsername: idClaims.preferred_username as string | undefined,
        name: idClaims.name as string | undefined,
      },
    }
  }

  private bindingMatches(binding: string | undefined, expectedHash: Buffer): boolean {
    if (!binding) return false
    return timingSafeEqual(bindingHash(binding), expectedHash)
  }

  // A Map preserves insertion order, so entries expire in the order they were
  // created. Delete the expired prefix and stop at the first live entry.
  private cleanupPendingAuths(): void {
    const now = this.now()
    for (const [key, value] of this.pendingAuths) {
      if (now - value.createdAt > PENDING_AUTH_TTL_MS) {
        this.pendingAuths.delete(key)
      } else {
        break
      }
    }
  }
}
