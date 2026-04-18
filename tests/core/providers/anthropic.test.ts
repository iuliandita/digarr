import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TasteProfile } from '@/core/types'

const mockCreate = vi.fn()
const anthropicCtorCalls: Array<Record<string, unknown>> = []

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function (
    this: Record<string, unknown>,
    options: Record<string, unknown>,
  ) {
    anthropicCtorCalls.push(options)
    this.messages = { create: mockCreate }
  })
  return { default: MockAnthropic }
})

// Import after mock is set up
const { AnthropicProvider } = await import('@/core/providers/anthropic')

const sampleProfile: TasteProfile = {
  topArtists: [
    { name: 'Boards of Canada', mbid: 'abc', playCount: 500, source: 'listenbrainz' },
    { name: 'Aphex Twin', mbid: 'def', playCount: 400, source: 'listenbrainz' },
  ],
  topGenres: [
    { name: 'ambient', weight: 0.8 },
    { name: 'electronic', weight: 0.6 },
  ],
  listeningPatterns: {
    totalListens: 10000,
    recentTrend: 'increasing',
  },
}

const sampleRecommendations = [
  {
    artistName: 'Grouper',
    reasoning: 'Ambient drone vibes',
    confidence: 0.85,
    genres: ['ambient', 'drone'],
  },
  {
    artistName: 'The Caretaker',
    reasoning: 'Hauntological ambient',
    confidence: 0.78,
    genres: ['ambient', 'experimental'],
  },
]

describe('AnthropicProvider', () => {
  let provider: InstanceType<typeof AnthropicProvider>

  beforeEach(() => {
    vi.clearAllMocks()
    anthropicCtorCalls.length = 0
    provider = new AnthropicProvider('test-api-key', 'claude-3-5-sonnet-20241022')
  })

  describe('baseURL', () => {
    test('omits baseURL when none provided', () => {
      new AnthropicProvider('k')
      const lastCall = anthropicCtorCalls.at(-1) ?? {}
      expect(lastCall.baseURL).toBeUndefined()
    })

    test('threads baseURL into SDK constructor', () => {
      new AnthropicProvider('k', 'claude-3-5-sonnet-20241022', 'https://proxy.example.com')
      const lastCall = anthropicCtorCalls.at(-1) ?? {}
      expect(lastCall.baseURL).toBe('https://proxy.example.com')
    })

    test('ignores null baseURL', () => {
      new AnthropicProvider('k', 'claude-3-5-sonnet-20241022', null)
      const lastCall = anthropicCtorCalls.at(-1) ?? {}
      expect(lastCall.baseURL).toBeUndefined()
    })
  })

  describe('getRecommendations', () => {
    test('returns parsed AiRecommendation[] from API response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify(sampleRecommendations),
          },
        ],
      })

      const result = await provider.getRecommendations(sampleProfile)

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        artistName: 'Grouper',
        reasoning: 'Ambient drone vibes',
        confidence: 0.85,
        genres: ['ambient', 'drone'],
      })
    })

    test('sends prompt that includes top artists from profile', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(sampleRecommendations) }],
      })

      await provider.getRecommendations(sampleProfile)

      expect(mockCreate).toHaveBeenCalledOnce()
      const callArgs = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ content: string }> }
      const promptText = callArgs.messages[0]?.content ?? ''
      expect(promptText).toContain('Boards of Canada')
      expect(promptText).toContain('Aphex Twin')
    })

    test('sends prompt that includes top genres from profile', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(sampleRecommendations) }],
      })

      await provider.getRecommendations(sampleProfile)

      const callArgs = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ content: string }> }
      const promptText = callArgs.messages[0]?.content ?? ''
      expect(promptText).toContain('ambient')
      expect(promptText).toContain('electronic')
    })

    test('handles JSON wrapped in markdown code fences', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: `Here are my recommendations:\n\`\`\`json\n${JSON.stringify(sampleRecommendations)}\n\`\`\``,
          },
        ],
      })

      const result = await provider.getRecommendations(sampleProfile)
      expect(result).toHaveLength(2)
      expect(result[0]?.artistName).toBe('Grouper')
    })

    test('throws on unexpected content type', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'image', source: { type: 'url', url: 'https://example.com' } }],
      })

      await expect(provider.getRecommendations(sampleProfile)).rejects.toThrow(
        'Unexpected response format',
      )
    })
  })

  describe('testConnection', () => {
    test('returns success when API call succeeds', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'pong' }],
      })

      const result = await provider.testConnection()

      expect(result.success).toBe(true)
      expect(result.message).toContain('Anthropic')
    })

    test('returns failure when API call throws', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Invalid API key'))

      const result = await provider.testConnection()

      expect(result.success).toBe(false)
      expect(result.message).toBe('Invalid API key')
    })
  })
})
