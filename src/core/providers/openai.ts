import OpenAI from 'openai'
import type { AiRecommendation, TasteProfile } from '@/core/types'
import { errMsg } from '@/core/validation'
import {
  buildRecommendationPrompt,
  parseRecommendationResponse,
  unwrapRecommendationArrayPayload,
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

    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a music discovery expert. Always respond with valid JSON containing an array called "recommendations".',
        },
        { role: 'user', content: prompt },
      ],
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      throw new Error('Empty response from OpenAI API')
    }

    return parseRecommendationResponse(unwrapRecommendationArrayPayload(content))
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
