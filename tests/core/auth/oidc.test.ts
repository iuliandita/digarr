import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>()
  return {
    ...actual,
    lookup: vi.fn(),
  }
})

vi.mock('openid-client', () => ({
  customFetch: Symbol.for('openid-client-custom-fetch'),
  discovery: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  authorizationCodeGrant: vi.fn(),
  randomState: vi.fn(() => 'mock-state'),
  randomNonce: vi.fn(() => 'mock-nonce'),
  randomPKCECodeVerifier: vi.fn(() => 'mock-code-verifier'),
  calculatePKCECodeChallenge: vi.fn(async () => 'mock-code-challenge'),
}))

import * as dns from 'node:dns/promises'
import * as oidcClient from 'openid-client'
import { OidcService } from '@/core/auth/oidc'

describe('OidcService', () => {
  let service: OidcService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new OidcService({
      issuerUrl: 'https://auth.example.com',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      scopes: 'openid profile email',
    })
  })

  describe('getAuthorizationUrl', () => {
    it('generates authorization URL with state and PKCE', async () => {
      vi.mocked(oidcClient.discovery).mockResolvedValue({} as never)
      vi.mocked(oidcClient.buildAuthorizationUrl).mockReturnValue(
        new URL(
          'https://auth.example.com/authorize?state=mock-state&code_challenge=mock-code-challenge',
        ),
      )

      const result = await service.getAuthorizationUrl(
        'http://localhost:3000/api/v1/auth/oidc/callback',
      )

      expect(oidcClient.discovery).toHaveBeenCalledWith(
        new URL('https://auth.example.com'),
        'test-client',
        'test-secret',
        undefined,
        expect.objectContaining({ [oidcClient.customFetch]: expect.any(Function) }),
      )
      expect(oidcClient.randomPKCECodeVerifier).toHaveBeenCalled()
      expect(oidcClient.calculatePKCECodeChallenge).toHaveBeenCalledWith('mock-code-verifier')
      expect(oidcClient.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          redirect_uri: 'http://localhost:3000/api/v1/auth/oidc/callback',
          scope: 'openid profile email',
          state: 'mock-state',
          nonce: 'mock-nonce',
          code_challenge: 'mock-code-challenge',
          code_challenge_method: 'S256',
        }),
      )
      expect(result.url).toContain('auth.example.com')
      expect(result.state).toBe('mock-state')
    })

    it('caches discovery config across calls', async () => {
      vi.mocked(oidcClient.discovery).mockResolvedValue({} as never)
      vi.mocked(oidcClient.buildAuthorizationUrl).mockReturnValue(
        new URL('https://auth.example.com/authorize?state=s1'),
      )

      await service.getAuthorizationUrl('http://localhost:3000/cb')
      await service.getAuthorizationUrl('http://localhost:3000/cb')

      expect(oidcClient.discovery).toHaveBeenCalledTimes(1)
    })

    it('propagates discovery errors', async () => {
      vi.mocked(oidcClient.discovery).mockRejectedValue(new Error('Network error'))

      await expect(service.getAuthorizationUrl('http://localhost:3000/cb')).rejects.toThrow(
        'Network error',
      )
    })

    it('normalizes bracketed IPv6 issuer URLs before custom DNS lookup', async () => {
      const ipv6Url = 'https://[2001:4860:4860::8888]/.well-known/openid-configuration'
      const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      vi.mocked(oidcClient.discovery).mockResolvedValue({} as never)
      vi.mocked(oidcClient.buildAuthorizationUrl).mockReturnValue(
        new URL('https://auth.example.com/authorize?state=mock-state'),
      )
      vi.mocked(dns.lookup).mockResolvedValue({
        address: '2001:4860:4860::8888',
        family: 6,
      } as never)

      await service.getAuthorizationUrl('http://localhost:3000/cb')

      const discoveryCall = vi.mocked(oidcClient.discovery).mock.calls[0]
      const options = discoveryCall?.[4]
      const customFetch = options?.[oidcClient.customFetch] as
        | ((url: string, init: RequestInit) => Promise<Response>)
        | undefined

      expect(customFetch).toBeDefined()

      await customFetch?.(ipv6Url, { headers: {} })

      expect(dns.lookup).toHaveBeenCalledWith('2001:4860:4860::8888')
      expect(fetchMock).toHaveBeenCalledWith(ipv6Url, expect.any(Object))

      vi.unstubAllGlobals()
    })

    it('pins OIDC HTTPS discovery requests that resolve to public IPv6 addresses', async () => {
      const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      vi.mocked(oidcClient.discovery).mockResolvedValue({} as never)
      vi.mocked(oidcClient.buildAuthorizationUrl).mockReturnValue(
        new URL('https://auth.example.com/authorize?state=mock-state'),
      )
      vi.mocked(dns.lookup).mockResolvedValue({
        address: '2606:2800:220:1:248:1893:25c8:1946',
        family: 6,
      } as never)

      await service.getAuthorizationUrl('http://localhost:3000/cb')

      const discoveryCall = vi.mocked(oidcClient.discovery).mock.calls[0]
      const options = discoveryCall?.[4]
      const customFetch = options?.[oidcClient.customFetch] as
        | ((url: string, init: RequestInit) => Promise<Response>)
        | undefined

      expect(customFetch).toBeDefined()

      await customFetch?.('https://auth.example.com/.well-known/openid-configuration', {
        headers: {},
      })

      expect(fetchMock).toHaveBeenCalledWith(
        'https://[2606:2800:220:1:248:1893:25c8:1946]/.well-known/openid-configuration',
        expect.objectContaining({
          headers: expect.any(Headers),
          tls: expect.objectContaining({ serverName: 'auth.example.com' }),
        }),
      )

      expect(fetchMock.mock.calls[0]).toBeDefined()
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit & { tls?: { serverName?: string } },
      ]
      expect(new Headers(init.headers).get('host')).toBe('auth.example.com')

      vi.unstubAllGlobals()
    })

    it('resetDiscovery forces re-fetch on next call', async () => {
      vi.mocked(oidcClient.discovery).mockResolvedValue({} as never)
      vi.mocked(oidcClient.buildAuthorizationUrl).mockReturnValue(
        new URL('https://auth.example.com/authorize?state=mock-state'),
      )

      await service.getAuthorizationUrl('http://localhost:3000/cb')
      expect(oidcClient.discovery).toHaveBeenCalledTimes(1)

      service.resetDiscovery()
      await service.getAuthorizationUrl('http://localhost:3000/cb')
      expect(oidcClient.discovery).toHaveBeenCalledTimes(2)
    })
  })

  describe('handleCallback', () => {
    it('exchanges code and returns user claims', async () => {
      const mockTokens = {
        claims: () => ({
          sub: 'user-123',
          email: 'alice@example.com',
          preferred_username: 'alice',
          iss: 'https://auth.example.com',
          aud: 'test-client',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        }),
        access_token: 'at-123',
        refresh_token: 'rt-456',
        id_token: 'id-tok-789',
        expiresIn: () => 3600,
      }
      vi.mocked(oidcClient.discovery).mockResolvedValue({} as never)
      vi.mocked(oidcClient.authorizationCodeGrant).mockResolvedValue(mockTokens as never)

      // Pre-populate pending auth state
      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      service['pendingAuths'].set('mock-state', {
        nonce: 'mock-nonce',
        codeVerifier: 'mock-code-verifier',
        redirectUri: 'http://localhost:3000/api/v1/auth/oidc/callback',
        createdAt: Date.now(),
      })

      const result = await service.handleCallback(
        new URL('http://localhost:3000/api/v1/auth/oidc/callback?code=auth-code&state=mock-state'),
      )

      expect(oidcClient.authorizationCodeGrant).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(URL),
        expect.objectContaining({
          pkceCodeVerifier: 'mock-code-verifier',
          expectedState: 'mock-state',
          expectedNonce: 'mock-nonce',
        }),
      )
      expect(result.claims.sub).toBe('user-123')
      expect(result.claims.email).toBe('alice@example.com')
      expect(result.claims.preferredUsername).toBe('alice')
      expect(result.accessToken).toBe('at-123')
      expect(result.refreshToken).toBe('rt-456')
      expect(result.idToken).toBe('id-tok-789')
      expect(result.expiresIn).toBe(3600)
    })

    it('cleans up pending auth after successful callback', async () => {
      const mockTokens = {
        claims: () => ({
          sub: 'user-123',
          iss: 'https://auth.example.com',
          aud: 'test-client',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        }),
        access_token: 'at-123',
        expiresIn: () => 3600,
      }
      vi.mocked(oidcClient.discovery).mockResolvedValue({} as never)
      vi.mocked(oidcClient.authorizationCodeGrant).mockResolvedValue(mockTokens as never)

      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      service['pendingAuths'].set('mock-state', {
        nonce: 'mock-nonce',
        codeVerifier: 'mock-code-verifier',
        redirectUri: 'http://localhost:3000/api/v1/auth/oidc/callback',
        createdAt: Date.now(),
      })

      await service.handleCallback(
        new URL('http://localhost:3000/api/v1/auth/oidc/callback?code=auth-code&state=mock-state'),
      )

      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      expect(service['pendingAuths'].has('mock-state')).toBe(false)
    })

    it('rejects callback with unknown state', async () => {
      await expect(
        service.handleCallback(
          new URL('http://localhost:3000/api/v1/auth/oidc/callback?code=x&state=unknown'),
        ),
      ).rejects.toThrow('Unknown or expired OIDC state')
    })

    it('rejects callback without state parameter', async () => {
      await expect(
        service.handleCallback(new URL('http://localhost:3000/api/v1/auth/oidc/callback?code=x')),
      ).rejects.toThrow('Missing state parameter')
    })

    it('handles missing id_token claims gracefully', async () => {
      const mockTokens = {
        claims: () => undefined,
        access_token: 'at-123',
        expiresIn: () => 3600,
      }
      vi.mocked(oidcClient.discovery).mockResolvedValue({} as never)
      vi.mocked(oidcClient.authorizationCodeGrant).mockResolvedValue(mockTokens as never)

      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      service['pendingAuths'].set('mock-state', {
        nonce: 'mock-nonce',
        codeVerifier: 'mock-code-verifier',
        redirectUri: 'http://localhost:3000/api/v1/auth/oidc/callback',
        createdAt: Date.now(),
      })

      await expect(
        service.handleCallback(
          new URL(
            'http://localhost:3000/api/v1/auth/oidc/callback?code=auth-code&state=mock-state',
          ),
        ),
      ).rejects.toThrow('No ID token claims')
    })

    it('propagates token exchange errors', async () => {
      vi.mocked(oidcClient.discovery).mockResolvedValue({} as never)
      vi.mocked(oidcClient.authorizationCodeGrant).mockRejectedValue(new Error('invalid_grant'))

      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      service['pendingAuths'].set('mock-state', {
        nonce: 'mock-nonce',
        codeVerifier: 'mock-code-verifier',
        redirectUri: 'http://localhost:3000/api/v1/auth/oidc/callback',
        createdAt: Date.now(),
      })

      await expect(
        service.handleCallback(
          new URL('http://localhost:3000/api/v1/auth/oidc/callback?code=x&state=mock-state'),
        ),
      ).rejects.toThrow('invalid_grant')
    })
  })

  describe('cleanupPendingAuths', () => {
    it('removes entries older than 10 minutes', () => {
      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      service['pendingAuths'].set('old-state', {
        nonce: 'n',
        codeVerifier: 'cv',
        redirectUri: 'http://localhost:3000/api/v1/auth/oidc/callback',
        createdAt: Date.now() - 20 * 60 * 1000,
      })
      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      service['pendingAuths'].set('fresh-state', {
        nonce: 'n2',
        codeVerifier: 'cv2',
        redirectUri: 'http://localhost:3000/api/v1/auth/oidc/callback',
        createdAt: Date.now(),
      })

      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      service['cleanupPendingAuths']()

      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      expect(service['pendingAuths'].has('old-state')).toBe(false)
      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      expect(service['pendingAuths'].has('fresh-state')).toBe(true)
    })

    it('handles empty map', () => {
      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      service['cleanupPendingAuths']()
      // biome-ignore lint/complexity/useLiteralKeys: accessing private field
      expect(service['pendingAuths'].size).toBe(0)
    })
  })

  describe('configuration', () => {
    it('requires issuerUrl', () => {
      expect(
        () =>
          new OidcService({
            issuerUrl: '',
            clientId: 'test',
            clientSecret: 'secret',
            scopes: 'openid',
          }),
      ).toThrow('issuerUrl is required')
    })

    it('requires clientId', () => {
      expect(
        () =>
          new OidcService({
            issuerUrl: 'https://auth.example.com',
            clientId: '',
            clientSecret: 'secret',
            scopes: 'openid',
          }),
      ).toThrow('clientId is required')
    })

    it('works without clientSecret (public client)', async () => {
      const pubService = new OidcService({
        issuerUrl: 'https://auth.example.com',
        clientId: 'public-client',
        scopes: 'openid',
      })

      vi.mocked(oidcClient.discovery).mockResolvedValue({} as never)
      vi.mocked(oidcClient.buildAuthorizationUrl).mockReturnValue(
        new URL('https://auth.example.com/authorize?state=mock-state'),
      )

      await pubService.getAuthorizationUrl('http://localhost:3000/cb')

      expect(oidcClient.discovery).toHaveBeenCalledWith(
        new URL('https://auth.example.com'),
        'public-client',
        undefined,
        undefined,
        expect.objectContaining({ [oidcClient.customFetch]: expect.any(Function) }),
      )
    })
  })
})
