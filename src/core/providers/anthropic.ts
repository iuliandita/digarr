import Anthropic from '@anthropic-ai/sdk'
import type { AiRecommendation, TasteProfile } from '@/core/types'
import { errMsg } from '@/core/validation'
import { buildRecommendationPrompt, parseRecommendationResponse } from './prompt'
import type { RecommendationProvider } from './types'

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

export class AnthropicProvider implements RecommendationProvider {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model: string = DEFAULT_MODEL, baseUrl?: string | null) {
    this.client = new Anthropic({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    })
    this.model = model
  }

  async getRecommendations(profile: TasteProfile): Promise<AiRecommendation[]> {
    const prompt = buildRecommendationPrompt(profile)

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const firstContent = response.content[0]
    if (!firstContent || firstContent.type !== 'text') {
      throw new Error('Unexpected response format from Anthropic API')
    }

    return parseRecommendationResponse(firstContent.text)
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      })

      return { success: true, message: `Connected to Anthropic (${this.model})` }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }
}
