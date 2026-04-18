import Anthropic from '@anthropic-ai/sdk'
import type { AiRecommendation, TasteProfile } from '@/core/types'
import { errMsg } from '@/core/validation'
import {
  buildRecommendationPrompt,
  getAiRecommendationsJsonSchema,
  parseRecommendationResponse,
  validateAiRecommendations,
} from './prompt'
import type { RecommendationProvider } from './types'

const RECOMMENDATION_TOOL_NAME = 'emit_recommendations'

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
    const schema = getAiRecommendationsJsonSchema() as {
      type: string
      properties: Record<string, unknown>
      required?: string[]
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
      tools: [
        {
          name: RECOMMENDATION_TOOL_NAME,
          description:
            'Emit the structured recommendation list. Call this tool exactly once with the complete array of recommendations.',
          input_schema: {
            type: 'object',
            properties: schema.properties,
            required: schema.required ?? ['recommendations'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: RECOMMENDATION_TOOL_NAME },
    })

    const toolUse = response.content.find((block) => block.type === 'tool_use')
    if (toolUse && toolUse.type === 'tool_use') {
      return validateAiRecommendations(toolUse.input)
    }

    // Fallback: some proxy deployments drop tool_use support - parse any text
    // block as a JSON array the old way.
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
