import * as dns from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Configuration } from 'openid-client'
import * as oidcClient from 'openid-client'
import { isPrivateIp } from '@/core/notifications'
import { errMsg, formatUrlHostname, getLookupHostname, normalizeIp } from '@/core/validation'

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
}

export interface OidcUserClaims {
  sub: string
  email?: string
  emailVerified?: boolean
  preferredUsername?: string
  name?: string
}

export interface CallbackResult {
  claims: OidcUserClaims
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresIn?: number
}

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000 // 10 minutes

export class OidcService {
  private config: OidcConfig
  private pendingAuths = new Map<string, PendingAuth>()
  private discoveryConfig: Configuration | null = null

  constructor(config: OidcConfig) {
    if (!config.issuerUrl) throw new Error('issuerUrl is required')
    if (!config.clientId) throw new Error('clientId is required')
    this.config = config
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

  async getAuthorizationUrl(redirectUri: string): Promise<{ url: string; state: string }> {
    this.cleanupPendingAuths()

    const config = await this.getDiscovery()

    const state = oidcClient.randomState()
    const nonce = oidcClient.randomNonce()
    const codeVerifier = oidcClient.randomPKCECodeVerifier()
    const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier)

    this.pendingAuths.set(state, {
      nonce,
      codeVerifier,
      redirectUri,
      createdAt: Date.now(),
    })

    const url = oidcClient.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: this.config.scopes,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    return { url: url.href, state }
  }

  async handleCallback(callbackUrl: URL): Promise<CallbackResult> {
    this.cleanupPendingAuths()

    const state = callbackUrl.searchParams.get('state')
    if (!state) throw new Error('Missing state parameter')

    const pending = this.pendingAuths.get(state)
    if (!pending) throw new Error('Unknown or expired OIDC state')

    this.pendingAuths.delete(state)

    const config = await this.getDiscovery()

    const tokens = await oidcClient.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: pending.codeVerifier,
      expectedState: state,
      expectedNonce: pending.nonce,
    })

    const idClaims = tokens.claims()
    if (!idClaims) throw new Error('No ID token claims in OIDC response')

    return {
      claims: {
        sub: idClaims.sub,
        email: idClaims.email as string | undefined,
        emailVerified: idClaims.email_verified as boolean | undefined,
        preferredUsername: idClaims.preferred_username as string | undefined,
        name: idClaims.name as string | undefined,
      },
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresIn: tokens.expiresIn(),
    }
  }

  private cleanupPendingAuths(): void {
    const now = Date.now()
    for (const [key, value] of this.pendingAuths) {
      if (now - value.createdAt > PENDING_AUTH_TTL_MS) {
        this.pendingAuths.delete(key)
      }
    }
  }
}
