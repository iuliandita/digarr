import type { AiRecommendation, TasteProfile } from '@/core/types'
import { errMsg } from '@/core/validation'
import { buildRecommendationPrompt, parseRecommendationResponse } from './prompt'
import { fetchWithRetry } from './retry'
import type { AiUsage, RecommendationProvider } from './types'

const DEFAULT_BASE_URL = 'http://localhost:11434'
const DEFAULT_TIMEOUT_SECONDS = 120

type OllamaChatResponse = {
  message: {
    role: string
    content: string
  }
  prompt_eval_count?: number
  eval_count?: number
}

type OllamaTagsResponse = {
  models: Array<{ name: string }>
}

export class OllamaProvider implements RecommendationProvider {
  private model: string
  private baseUrl: string
  private timeoutMs: number
  lastUsage: AiUsage | null = null

  constructor(
    model: string,
    baseUrl: string = DEFAULT_BASE_URL,
    timeoutSeconds: number = DEFAULT_TIMEOUT_SECONDS,
  ) {
    this.model = model
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.timeoutMs = Math.max(1, timeoutSeconds) * 1000
  }

  async getRecommendations(profile: TasteProfile): Promise<AiRecommendation[]> {
    this.lastUsage = null
    const prompt = buildRecommendationPrompt(profile)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            format: 'json',
            stream: false,
          }),
          signal: controller.signal,
        },
        { providerLabel: 'ollama' },
      )

      const data = (await response.json()) as OllamaChatResponse
      const content = data.message?.content

      if (data.prompt_eval_count != null || data.eval_count != null) {
        this.lastUsage = {
          provider: 'ollama',
          model: this.model,
          inputTokens: data.prompt_eval_count,
          outputTokens: data.eval_count,
        }
      }

      if (!content) {
        throw new Error('Empty response from Ollama API')
      }

      return parseRecommendationResponse(content)
    } finally {
      clearTimeout(timer)
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      })

      if (!response.ok) {
        return {
          success: false,
          message: `Ollama returned ${response.status} ${response.statusText}`,
        }
      }

      const data = (await response.json()) as OllamaTagsResponse
      const modelCount = data.models?.length ?? 0

      return {
        success: true,
        message: `Connected to Ollama - ${modelCount} model(s) available`,
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    } finally {
      clearTimeout(timer)
    }
  }
}
