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

    test('threads timeout into SDK constructor', () => {
      new AnthropicProvider('k', 'claude-3-5-sonnet-20241022', null, 45)
      const lastCall = anthropicCtorCalls.at(-1) ?? {}
      expect(lastCall.timeout).toBe(45_000)
    })
  })

  describe('getRecommendations', () => {
    test('prefers the tool_use block when present', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            name: 'emit_recommendations',
            input: { recommendations: sampleRecommendations },
          },
        ],
      })

      const result = await provider.getRecommendations(sampleProfile)

      expect(result).toHaveLength(2)
      expect(result[0]?.artistName).toBe('Grouper')
    })

    test('requests the emit_recommendations tool', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            name: 'emit_recommendations',
            input: { recommendations: sampleRecommendations },
          },
        ],
      })

      await provider.getRecommendations(sampleProfile)
      const callArgs = mockCreate.mock.calls[0]?.[0] as {
        tools?: Array<{ name: string; strict?: boolean; input_schema?: Record<string, unknown> }>
        tool_choice?: Record<string, unknown>
        system?: Array<{ type: string; text: string }>
      }
      expect(callArgs.tools?.[0]?.name).toBe('emit_recommendations')
      expect(callArgs.tools?.[0]?.input_schema).toBeDefined()
      // Sonnet 5.5, Opus 5.5 and Fable 5.1 reject `tool` and `any` with a 400.
      expect(callArgs.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true })
      expect(callArgs.system?.at(-1)?.text).toContain(
        'calling the emit_recommendations tool exactly once',
      )
    })

    test('sends a strict tool schema without keywords strict mode rejects', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            name: 'emit_recommendations',
            input: { recommendations: sampleRecommendations },
          },
        ],
      })

      await provider.getRecommendations(sampleProfile)
      const callArgs = mockCreate.mock.calls[0]?.[0] as {
        tools?: Array<{ strict?: boolean; input_schema: Record<string, unknown> }>
      }
      const tool = callArgs.tools?.[0]
      expect(tool?.strict).toBe(true)
      expect(tool?.input_schema).toEqual({
        type: 'object',
        properties: {
          recommendations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                artistName: { type: 'string' },
                reasoning: { type: 'string' },
                confidence: { type: 'number' },
                genres: { type: 'array', items: { type: 'string' } },
                suggestedAlbum: { type: 'string' },
              },
              required: ['artistName', 'reasoning', 'confidence', 'genres'],
              additionalProperties: false,
            },
          },
        },
        required: ['recommendations'],
        additionalProperties: false,
      })
    })

    test('still enforces the schema bounds on the tool input', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            name: 'emit_recommendations',
            input: {
              recommendations: [
                ...sampleRecommendations,
                { artistName: 'Too Sure', reasoning: 'x', confidence: 1.5, genres: [] },
              ],
            },
          },
        ],
      })

      const result = await provider.getRecommendations(sampleProfile)
      expect(result.map((rec) => rec.artistName)).toEqual(['Grouper', 'The Caretaker'])
    })

    test('names the tool in the system prompt for pre-built prompts too', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            name: 'emit_recommendations',
            input: { recommendations: sampleRecommendations },
          },
        ],
      })

      await provider.getRecommendations({ ...sampleProfile, _rawPrompt: 'Recommend calm music.' })
      const args = mockCreate.mock.calls[0]?.[0] as {
        system?: Array<{ type: string; text: string; cache_control?: unknown }>
        messages: Array<{ content: string }>
      }
      expect(args.system).toHaveLength(1)
      expect(args.system?.[0]?.cache_control).toBeUndefined()
      expect(args.system?.[0]?.text).toContain('emit_recommendations')
      expect(args.messages[0]?.content).toBe('Recommend calm music.')
    })

    test('retries once when the reply has neither a tool call nor a JSON array', async () => {
      mockCreate
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Here are some artists you might like.' }],
          usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 90 },
        })
        .mockResolvedValueOnce({
          content: [
            {
              type: 'tool_use',
              name: 'emit_recommendations',
              input: { recommendations: sampleRecommendations },
            },
          ],
          usage: { input_tokens: 100, output_tokens: 80, cache_read_input_tokens: 90 },
        })

      const result = await provider.getRecommendations(sampleProfile)

      expect(result).toHaveLength(2)
      expect(mockCreate).toHaveBeenCalledTimes(2)
      expect(mockCreate.mock.calls[1]?.[0]).toEqual(mockCreate.mock.calls[0]?.[0])
      // Both requests are billed, so the recorded usage covers both.
      expect(provider.lastUsage).toEqual({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        inputTokens: 200,
        outputTokens: 90,
        cacheReadInputTokens: 90,
        cacheCreationInputTokens: 90,
      })
    })

    test('throws after the retry also comes back without recommendations', async () => {
      const reply = { content: [{ type: 'text', text: 'Sorry, I cannot help with that.' }] }
      mockCreate.mockResolvedValueOnce(reply).mockResolvedValueOnce(reply)

      await expect(provider.getRecommendations(sampleProfile)).rejects.toThrow(
        'No JSON array found',
      )
      expect(mockCreate).toHaveBeenCalledTimes(2)
    })

    test('does not retry when the tool input has the wrong shape', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'tool_use', name: 'emit_recommendations', input: { artists: [] } }],
      })

      await expect(provider.getRecommendations(sampleProfile)).rejects.toThrow(
        'did not contain a recommendations array',
      )
      expect(mockCreate).toHaveBeenCalledOnce()
    })

    test('parses a text answer that follows a thinking block', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: JSON.stringify(sampleRecommendations) },
        ],
      })

      const result = await provider.getRecommendations(sampleProfile)

      expect(result).toHaveLength(2)
      expect(mockCreate).toHaveBeenCalledOnce()
    })

    test('falls back to text parsing when no tool_use block returned', async () => {
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

    test('sends cacheable system prelude with ephemeral cache_control', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            name: 'emit_recommendations',
            input: { recommendations: sampleRecommendations },
          },
        ],
      })

      await provider.getRecommendations(sampleProfile)
      const args = mockCreate.mock.calls[0]?.[0] as {
        system?: Array<{ type: string; text: string; cache_control?: { type: string } }>
        messages: Array<{ content: string }>
      }
      expect(args.system?.[0]?.type).toBe('text')
      expect(args.system?.[0]?.cache_control).toEqual({ type: 'ephemeral' })
      // The system block must NOT contain the listener-specific profile data;
      // profile fields must live in the user turn so the prelude is cacheable.
      expect(args.system?.[0]?.text).not.toContain('Boards of Canada')
      expect(args.messages[0]?.content).toContain('Boards of Canada')
    })

    test('records lastUsage from the response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            name: 'emit_recommendations',
            input: { recommendations: sampleRecommendations },
          },
        ],
        usage: {
          input_tokens: 120,
          output_tokens: 80,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 20,
        },
      })

      await provider.getRecommendations(sampleProfile)
      expect(provider.lastUsage).toEqual({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        inputTokens: 120,
        outputTokens: 80,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 20,
      })
    })

    test('resets lastUsage when a prior call completed without usage', async () => {
      mockCreate
        .mockResolvedValueOnce({
          content: [
            {
              type: 'tool_use',
              name: 'emit_recommendations',
              input: { recommendations: sampleRecommendations },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        })
        .mockResolvedValueOnce({
          content: [
            {
              type: 'tool_use',
              name: 'emit_recommendations',
              input: { recommendations: sampleRecommendations },
            },
          ],
        })
      await provider.getRecommendations(sampleProfile)
      expect(provider.lastUsage).not.toBeNull()
      await provider.getRecommendations(sampleProfile)
      expect(provider.lastUsage).toBeNull()
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
      const reply = {
        content: [{ type: 'image', source: { type: 'url', url: 'https://example.com' } }],
      }
      mockCreate.mockResolvedValueOnce(reply).mockResolvedValueOnce(reply)

      await expect(provider.getRecommendations(sampleProfile)).rejects.toThrow(
        'Unexpected response format',
      )
      expect(mockCreate).toHaveBeenCalledTimes(2)
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
