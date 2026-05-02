import OpenAI from 'openai'
import type { AiRecommendation, TasteProfile } from '@/core/types'
import { errMsg } from '@/core/validation'
import {
  buildRecommendationPrompt,
  getAiRecommendationsJsonSchema,
  validateAiRecommendations,
} from './prompt'
import { optionalTimeoutSecondsToMs } from './timeout'
import type { AiUsage, RecommendationProvider } from './types'

const DEFAULT_MODEL = 'gpt-5.4-mini'

export class OpenAIProvider implements RecommendationProvider {
  private client: OpenAI
  private model: string
  lastUsage: AiUsage | null = null

  constructor(
    apiKey: string,
    model: string = DEFAULT_MODEL,
    baseUrl?: string | null,
    timeoutSeconds?: number | null,
  ) {
    const timeoutMs = optionalTimeoutSecondsToMs(timeoutSeconds)
    this.client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    })
    this.model = model
  }

  async getRecommendations(profile: TasteProfile): Promise<AiRecommendation[]> {
    this.lastUsage = null
    const prompt = buildRecommendationPrompt(profile)
    const schema = getAiRecommendationsJsonSchema()

    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'music_recommendations',
          schema: schema as Record<string, unknown>,
          strict: false,
        },
      },
      max_completion_tokens: 4096,
      messages: [
        {
          role: 'system',
          content:
            'You are a music discovery expert. Respond with a JSON object matching the provided schema (a "recommendations" array).',
        },
        { role: 'user', content: prompt },
      ],
    })

    if (response.usage) {
      this.lastUsage = {
        provider: 'openai',
        model: this.model,
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      }
    }

    const content = response.choices[0]?.message?.content
    if (!content) {
      throw new Error('Empty response from OpenAI API')
    }

    return validateAiRecommendations(JSON.parse(content))
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      })

      return { success: true, message: `Connected to OpenAI (${this.model})` }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }
}
