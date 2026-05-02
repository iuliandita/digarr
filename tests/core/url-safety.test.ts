// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateAiBaseUrl, validatePublicServiceUrl } from '@/core/url-safety'

const lookupMock = vi.hoisted(() => vi.fn())

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}))

beforeEach(() => {
  lookupMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('validatePublicServiceUrl', () => {
  it('rejects non-http(s) URLs', async () => {
    const result = await validatePublicServiceUrl('ftp://example.com', 'AI base URL')
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('http://'),
    })
  })

  it('rejects cloud metadata hostnames before resolving', async () => {
    const result = await validatePublicServiceUrl('http://169.254.169.254/latest', 'AI base URL')
    expect(result.ok).toBe(false)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects URLs that resolve to a private IP', async () => {
    lookupMock.mockResolvedValueOnce({ address: '10.0.0.5', family: 4 })
    const result = await validatePublicServiceUrl('https://example.com', 'AI base URL')
    expect(result).toEqual({ ok: false, message: 'AI base URL resolves to a private/internal IP' })
  })

  it('passes when hostname resolves to a public address', async () => {
    lookupMock.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 })
    const result = await validatePublicServiceUrl('https://example.com', 'AI base URL')
    expect(result).toEqual({ ok: true })
  })
})

describe('validateAiBaseUrl', () => {
  it('returns ok for an empty URL regardless of provider', async () => {
    const result = await validateAiBaseUrl('', 'ollama', 'AI base URL')
    expect(result).toEqual({ ok: true })
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('blocks cloud metadata hostnames for local providers', async () => {
    const result = await validateAiBaseUrl(
      'http://metadata.google.internal/computeMetadata/v1/',
      'ollama',
      'AI base URL',
    )
    expect(result.ok).toBe(false)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('blocks the AWS metadata IP for local providers (DNS rebinding defence)', async () => {
    lookupMock.mockResolvedValueOnce({ address: '169.254.169.254', family: 4 })
    const result = await validateAiBaseUrl(
      'http://my-rebound-host.example/',
      'ollama',
      'AI base URL',
    )
    expect(result).toEqual({ ok: false, message: 'AI base URL resolves to a cloud metadata IP' })
  })

  it('blocks IPv4-mapped IPv6 metadata responses for local providers', async () => {
    lookupMock.mockResolvedValueOnce({ address: '::ffff:a9fe:a9fe', family: 6 })
    const result = await validateAiBaseUrl(
      'http://mapped-metadata.example/',
      'openai-compatible',
      'AI base URL',
    )
    expect(result).toEqual({ ok: false, message: 'AI base URL resolves to a cloud metadata IP' })
  })

  it('allows local providers to use a localhost hostname', async () => {
    lookupMock.mockResolvedValueOnce({ address: '127.0.0.1', family: 4 })
    const result = await validateAiBaseUrl('http://localhost:11434', 'ollama', 'AI base URL')
    expect(result).toEqual({ ok: true })
  })

  it('allows local providers to use a LAN address', async () => {
    lookupMock.mockResolvedValueOnce({ address: '192.168.1.5', family: 4 })
    const result = await validateAiBaseUrl(
      'http://192.168.1.5:8080',
      'openai-compatible',
      'AI base URL',
    )
    expect(result).toEqual({ ok: true })
  })

  it('rejects private addresses for hosted providers (anthropic)', async () => {
    lookupMock.mockResolvedValueOnce({ address: '127.0.0.1', family: 4 })
    const result = await validateAiBaseUrl('http://localhost:8080', 'anthropic', 'AI base URL')
    expect(result.ok).toBe(false)
  })

  it('passes for hosted providers with a public proxy URL', async () => {
    lookupMock.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 })
    const result = await validateAiBaseUrl(
      'https://api.proxy.example/anthropic',
      'anthropic',
      'AI base URL',
    )
    expect(result).toEqual({ ok: true })
  })
})
