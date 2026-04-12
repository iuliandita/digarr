// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/oauth-tokens', () => ({
  getOAuthToken: vi.fn(),
  deleteOAuthToken: vi.fn(),
}))

const { getOAuthToken } = await import('@/db/queries/oauth-tokens')
const { resolveDeezerToken } = await import('@/core/deezer-auth')

const mockDb = {} as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveDeezerToken', () => {
  it('returns stored token when valid', async () => {
    vi.mocked(getOAuthToken).mockResolvedValueOnce({
      accessToken: 'valid-token',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 86400000),
      provider: 'deezer',
      userId: 1,
      scopes: 'basic_access',
      clientId: null,
      clientSecret: null,
      id: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const token = await resolveDeezerToken(mockDb, 1)
    expect(token).toBe('valid-token')
  })

  it('returns stored token even if expired (Deezer tokens are long-lived)', async () => {
    vi.mocked(getOAuthToken).mockResolvedValueOnce({
      accessToken: 'old-token',
      refreshToken: null,
      expiresAt: new Date(Date.now() - 86400000),
      provider: 'deezer',
      userId: 1,
      scopes: 'basic_access',
      clientId: null,
      clientSecret: null,
      id: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const token = await resolveDeezerToken(mockDb, 1)
    expect(token).toBe('old-token')
  })

  it('throws when no token stored', async () => {
    vi.mocked(getOAuthToken).mockResolvedValueOnce(null)

    await expect(resolveDeezerToken(mockDb, 1)).rejects.toThrow('No Deezer OAuth token')
  })

  it('throws when token is pending', async () => {
    vi.mocked(getOAuthToken).mockResolvedValueOnce({
      accessToken: 'pending:1:abc',
      refreshToken: null,
      expiresAt: new Date(),
      provider: 'deezer',
      userId: 1,
      scopes: null,
      clientId: null,
      clientSecret: null,
      id: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(resolveDeezerToken(mockDb, 1)).rejects.toThrow('No Deezer OAuth token')
  })
})
