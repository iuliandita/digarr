// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fetchWithRetry } from '@/core/providers/retry'

describe('fetchWithRetry', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test('returns the response on the first successful attempt', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const res = await fetchWithRetry('https://example.com', {}, { minTimeout: 1 })
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('retries on 500 responses and eventually returns success', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom', { status: 502 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const res = await fetchWithRetry('https://example.com', {}, { minTimeout: 1, retries: 3 })
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  test('does not retry on 4xx other than 429', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 401 }))
    await expect(
      fetchWithRetry('https://example.com', {}, { minTimeout: 1, retries: 5 }),
    ).rejects.toThrow(/client error 401/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('retries on 429 responses', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const res = await fetchWithRetry('https://example.com', {}, { minTimeout: 1 })
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  test('honours integer Retry-After header delay', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response('slow down', { status: 429, headers: { 'Retry-After': '1' } }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const started = Date.now()
    const res = await fetchWithRetry('https://example.com', {}, { minTimeout: 1, retries: 2 })
    const elapsed = Date.now() - started
    expect(res.status).toBe(200)
    // ~1s sleep from Retry-After; give generous slack for CI jitter
    expect(elapsed).toBeGreaterThanOrEqual(900)
  })

  test('exhausts retries and surfaces the upstream failure', async () => {
    fetchSpy.mockResolvedValue(new Response('boom', { status: 500 }))
    await expect(
      fetchWithRetry('https://example.com', {}, { minTimeout: 1, retries: 2 }),
    ).rejects.toThrow(/upstream 500/)
    // 1 initial + 2 retries = 3 calls
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })
})
