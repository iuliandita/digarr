import OpenAI from 'openai'
import type { AiRecommendation, TasteProfile } from '@/core/types'
import { errMsg } from '@/core/validation'
import {
  buildRecommendationPrompt,
  getAiRecommendationsJsonSchema,
  validateAiRecommendations,
} from './prompt'
import type { RecommendationProvider } from './types'

const DEFAULT_MODEL = 'gpt-5.4-mini'

export class OpenAIProvider implements RecommendationProvider {
  private client: OpenAI
  private model: string

  constructor(apiKey: string, model: string = DEFAULT_MODEL, baseUrl?: string | null) {
    this.client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    })
    this.model = model
  }

  async getRecommendations(profile: TasteProfile): Promise<AiRecommendation[]> {
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
