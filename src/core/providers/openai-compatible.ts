import type { AiRecommendation, TasteProfile } from '@/core/types'
import { errMsg } from '@/core/validation'
import {
  buildRecommendationPrompt,
  parseRecommendationResponse,
  unwrapRecommendationArrayPayload,
} from './prompt'
import { fetchWithRetry } from './retry'
import { timeoutSecondsWithDefaultToMs } from './timeout'
import type { AiUsage, RecommendationProvider } from './types'

const DEFAULT_TIMEOUT_SECONDS = 60

export class OpenAICompatibleProvider implements RecommendationProvider {
  private baseUrl: string
  private apiKey: string | null
  private model: string
  private timeoutMs: number
  lastUsage: AiUsage | null = null

  constructor(
    baseUrl: string,
    model: string,
    apiKey: string | null = null,
    timeoutSeconds?: number | null,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.model = model
    this.apiKey = apiKey
    this.timeoutMs = timeoutSecondsWithDefaultToMs(timeoutSeconds, DEFAULT_TIMEOUT_SECONDS)
  }

  async getRecommendations(profile: TasteProfile): Promise<AiRecommendation[]> {
    this.lastUsage = null
    const prompt = buildRecommendationPrompt(profile)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetchWithRetry(
        `${this.baseUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: 'Respond with a JSON array only.' },
              { role: 'user', content: prompt },
            ],
            max_completion_tokens: 4096,
          }),
          signal: controller.signal,
        },
        { providerLabel: 'openai-compatible' },
      )

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      if (data.usage) {
        this.lastUsage = {
          provider: 'openai-compatible',
          model: this.model,
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        }
      }
      const text = data.choices?.[0]?.message?.content
      if (!text) throw new Error('Empty response')
      return parseRecommendationResponse(unwrapRecommendationArrayPayload(text))
    } finally {
      clearTimeout(timer)
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_completion_tokens: 10,
        }),
        signal: controller.signal,
      })

      if (res.ok) {
        return { success: true, message: `Connected to ${this.baseUrl} (${this.model})` }
      }
      const body = await res.text().catch(() => '')
      return { success: false, message: body || `HTTP ${res.status}` }
    } catch (err: unknown) {
      return {
        success: false,
        message: errMsg(err),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
