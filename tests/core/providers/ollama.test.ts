import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OllamaProvider } from '@/core/providers/ollama'
import type { TasteProfile } from '@/core/types'

const sampleProfile: TasteProfile = {
  topArtists: [
    { name: 'Godspeed You! Black Emperor', mbid: 'zzz', playCount: 600, source: 'listenbrainz' },
    { name: 'Mogwai', mbid: 'yyy', playCount: 450, source: 'listenbrainz' },
  ],
  topGenres: [
    { name: 'post-rock', weight: 0.95 },
    { name: 'drone', weight: 0.7 },
  ],
  listeningPatterns: {
    totalListens: 15000,
    recentTrend: 'decreasing',
  },
}

const sampleRecommendations = [
  {
    artistName: 'Explosions in the Sky',
    reasoning: 'Post-rock cinematic landscapes',
    confidence: 0.91,
    genres: ['post-rock', 'instrumental'],
  },
  {
    artistName: 'Sigur Ros',
    reasoning: 'Epic atmospheric sound',
    confidence: 0.88,
    genres: ['post-rock', 'ambient'],
  },
]

describe('OllamaProvider', () => {
  let provider: OllamaProvider
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    provider = new OllamaProvider('llama3', 'http://localhost:11434')
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  describe('getRecommendations', () => {
    test('returns parsed AiRecommendation[] from Ollama response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: {
              role: 'assistant',
              content: JSON.stringify(sampleRecommendations),
            },
          }),
          { status: 200 },
        ),
      )

      const result = await provider.getRecommendations(sampleProfile)

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        artistName: 'Explosions in the Sky',
        confidence: 0.91,
        genres: ['post-rock', 'instrumental'],
      })
    })

    test('sends request to /api/chat with correct body', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: JSON.stringify(sampleRecommendations) },
          }),
          { status: 200 },
        ),
      )

      await provider.getRecommendations(sampleProfile)

      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://localhost:11434/api/chat')
      expect(init.method).toBe('POST')

      const body = JSON.parse(init.body as string) as {
        model: string
        messages: Array<{ role: string; content: string }>
        format: string
        stream: boolean
      }
      expect(body.model).toBe('llama3')
      expect(body.stream).toBe(false)
      expect(body.format).toBe('json')
    })

    test('sends prompt that includes top artists from profile', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: JSON.stringify(sampleRecommendations) },
          }),
          { status: 200 },
        ),
      )

      await provider.getRecommendations(sampleProfile)

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as {
        messages: Array<{ content: string }>
      }
      const promptText = body.messages[0]?.content ?? ''
      expect(promptText).toContain('Godspeed You! Black Emperor')
      expect(promptText).toContain('Mogwai')
    })

    test('sends prompt that includes top genres from profile', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: JSON.stringify(sampleRecommendations) },
          }),
          { status: 200 },
        ),
      )

      await provider.getRecommendations(sampleProfile)

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as {
        messages: Array<{ content: string }>
      }
      const promptText = body.messages[0]?.content ?? ''
      expect(promptText).toContain('post-rock')
      expect(promptText).toContain('drone')
    })

    test('throws on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Model not found', { status: 404 }))

      await expect(provider.getRecommendations(sampleProfile)).rejects.toThrow('Ollama API error')
    })
  })

  describe('testConnection', () => {
    test('returns success with model count from /api/tags', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [{ name: 'llama3' }, { name: 'mistral' }],
          }),
          { status: 200 },
        ),
      )

      const result = await provider.testConnection()

      expect(result.success).toBe(true)
      expect(result.message).toContain('2')
    })

    test('returns failure on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Service unavailable', { status: 503 }))

      const result = await provider.testConnection()

      expect(result.success).toBe(false)
      expect(result.message).toContain('503')
    })

    test('returns failure when fetch throws (network error)', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const result = await provider.testConnection()

      expect(result.success).toBe(false)
      expect(result.message).toBe('ECONNREFUSED')
    })

    test('calls /api/tags endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200 }))

      await provider.testConnection()

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
  })
})
