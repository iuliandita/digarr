import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from '@/core/providers/openai-compatible'
import type { TasteProfile } from '@/core/types'

const TEST_BASE_URL = 'http://openai.example.com:8080'
const sampleProfile: TasteProfile = {
  topArtists: [{ name: 'Portishead', playCount: 50, source: 'lastfm' }],
  topGenres: [{ name: 'trip-hop', weight: 1 }],
  listeningPatterns: { totalListens: 200, recentTrend: 'stable' },
}

describe('OpenAICompatibleProvider', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')

  afterEach(() => fetchSpy.mockReset())

  it('sends request to custom base URL', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    artistName: 'Massive Attack',
                    reasoning: 'Trip-hop pioneers.',
                    confidence: 0.85,
                    genres: ['trip-hop', 'electronic'],
                  },
                ]),
              },
            },
          ],
        }),
      ),
    )

    const provider = new OpenAICompatibleProvider(TEST_BASE_URL, 'local-model', 'key123')
    const results = await provider.getRecommendations(sampleProfile)

    expect(results).toHaveLength(1)
    expect(results[0]?.artistName).toBe('Massive Attack')

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${TEST_BASE_URL}/v1/chat/completions`)
  })

  it('works without API key', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '[]' } }],
        }),
      ),
    )

    const provider = new OpenAICompatibleProvider(TEST_BASE_URL, 'model')
    await provider.getRecommendations({
      topArtists: [{ name: 'Test', playCount: 1, source: 'lastfm' }],
      topGenres: [{ name: 'rock', weight: 1 }],
      listeningPatterns: { totalListens: 1, recentTrend: 'stable' },
    })

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('includes Authorization header when API key provided', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '[]' } }],
        }),
      ),
    )

    const provider = new OpenAICompatibleProvider(TEST_BASE_URL, 'model', 'sk-key')
    await provider.getRecommendations({
      topArtists: [{ name: 'Test', playCount: 1, source: 'lastfm' }],
      topGenres: [{ name: 'rock', weight: 1 }],
      listeningPatterns: { totalListens: 1, recentTrend: 'stable' },
    })

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-key')
  })

  it('testConnection returns success on 200', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'pong' } }],
        }),
      ),
    )

    const provider = new OpenAICompatibleProvider(TEST_BASE_URL, 'model')
    const result = await provider.testConnection()
    expect(result.success).toBe(true)
    expect(result.message).toContain('openai.example.com:8080')
  })

  it('handles wrapped JSON object response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  recommendations: [
                    {
                      artistName: 'Burial',
                      reasoning: 'UK dubstep.',
                      confidence: 0.8,
                      genres: ['dubstep'],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      ),
    )

    const provider = new OpenAICompatibleProvider(TEST_BASE_URL, 'model')
    const results = await provider.getRecommendations({
      topArtists: [{ name: 'Test', playCount: 1, source: 'lastfm' }],
      topGenres: [{ name: 'electronic', weight: 1 }],
      listeningPatterns: { totalListens: 1, recentTrend: 'stable' },
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.artistName).toBe('Burial')
  })

  it('aborts getRecommendations when configured timeout elapses', async () => {
    vi.useFakeTimers()
    const provider = new OpenAICompatibleProvider(TEST_BASE_URL, 'model', null, 1)
    fetchSpy.mockImplementationOnce(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const abortErr = new Error('aborted')
          abortErr.name = 'AbortError'
          init?.signal?.addEventListener('abort', () => reject(abortErr))
        }),
    )

    try {
      const pending = provider.getRecommendations(sampleProfile)
      const rejection = expect(pending).rejects.toThrow(/abort/i)
      await vi.advanceTimersByTimeAsync(1000)
      await rejection
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
