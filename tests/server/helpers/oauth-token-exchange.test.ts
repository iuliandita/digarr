// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exchangeAuthCode } from '@/server/helpers/oauth-token-exchange'

const originalFetch = global.fetch

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

function params() {
  return new URLSearchParams({ grant_type: 'authorization_code', code: 'abc' })
}

describe('exchangeAuthCode', () => {
  it('POSTs a form body with the Basic header when credentials are given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ access_token: 'tok' }),
    } as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await exchangeAuthCode({
      provider: 'TIDAL',
      tokenUrl: 'https://tidal.test/token',
      params: params(),
      basicAuth: { clientId: 'cid', clientSecret: 'secret' },
    })

    expect(result).toEqual({ ok: true, data: { access_token: 'tok' } })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://tidal.test/token')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Basic ${btoa('cid:secret')}`)
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(init.body).toContain('grant_type=authorization_code')
  })

  it('sends the params as a query string and no body when method is GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ access_token: 'tok' }),
    } as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await exchangeAuthCode({
      provider: 'Deezer',
      tokenUrl: 'https://deezer.test/token',
      params: params(),
      method: 'GET',
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://deezer.test/token?grant_type=authorization_code&code=abc')
    expect(init.body).toBeUndefined()
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('reports an unreachable endpoint distinctly from a rejected exchange', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch

    await expect(
      exchangeAuthCode({
        provider: 'TIDAL',
        tokenUrl: 'https://tidal.test/token',
        params: params(),
      }),
    ).resolves.toEqual({ ok: false, error: 'token_exchange_unreachable' })
  })

  it('reports a non-ok status as a failed exchange and redacts the logged body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid_client client_secret=hunter2',
    } as Response) as unknown as typeof fetch

    const result = await exchangeAuthCode({
      provider: 'TIDAL',
      tokenUrl: 'https://tidal.test/token',
      params: params(),
    })

    expect(result).toEqual({ ok: false, error: 'token_exchange_failed' })
    const logged = vi.mocked(console.error).mock.calls[0]?.[0] as string
    expect(logged).toContain('401')
    expect(logged).not.toContain('hunter2')
  })

  it('reports a non-JSON body as malformed unless a form response is allowed', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'access_token=form-token&expires=0',
    } as Response) as unknown as typeof fetch

    await expect(
      exchangeAuthCode({
        provider: 'TIDAL',
        tokenUrl: 'https://tidal.test/token',
        params: params(),
      }),
    ).resolves.toEqual({ ok: false, error: 'token_exchange_malformed' })

    await expect(
      exchangeAuthCode({
        provider: 'Deezer',
        tokenUrl: 'https://deezer.test/token',
        params: params(),
        allowFormResponse: true,
      }),
    ).resolves.toEqual({ ok: true, data: { access_token: 'form-token', expires: '0' } })
  })

  it('survives a response whose body cannot be read', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500 } as Response) as unknown as typeof fetch

    await expect(
      exchangeAuthCode({
        provider: 'TIDAL',
        tokenUrl: 'https://tidal.test/token',
        params: params(),
      }),
    ).resolves.toEqual({ ok: false, error: 'token_exchange_failed' })
  })
})
