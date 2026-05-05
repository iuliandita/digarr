import type { AiRecommendation, TasteProfile } from '@/core/types'
import { errMsg } from '@/core/validation'
import {
  buildRecommendationPrompt,
  getAiRecommendationsJsonSchema,
  validateAiRecommendations,
} from './prompt'
import { fetchWithRetry } from './retry'
import { timeoutSecondsWithDefaultToMs } from './timeout'
import type { AiUsage, RecommendationProvider } from './types'

const DEFAULT_MODEL = 'gemini-3-flash-preview'
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_TIMEOUT_SECONDS = 60

// Gemini's responseSchema is a subset of JSON Schema and rejects fields like
// `$schema`, `additionalProperties`, `exclusiveMinimum`, etc. Strip the ones
// that are known to cause 400s while keeping the shape-defining fields.
const GEMINI_DROP_KEYS = new Set([
  '$schema',
  '$id',
  'additionalProperties',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'default',
  'const',
  'examples',
])
function sanitizeGeminiSchema(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((v) => sanitizeGeminiSchema(v))
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) {
      if (GEMINI_DROP_KEYS.has(k)) continue
      out[k] = sanitizeGeminiSchema(v)
    }
    return out
  }
  return input
}

export class GeminiProvider implements RecommendationProvider {
  private apiKey: string
  private model: string
  private timeoutMs: number
  lastUsage: AiUsage | null = null

  constructor(apiKey: string, model: string = DEFAULT_MODEL, timeoutSeconds?: number | null) {
    this.apiKey = apiKey
    this.model = model
    this.timeoutMs = timeoutSecondsWithDefaultToMs(timeoutSeconds, DEFAULT_TIMEOUT_SECONDS)
  }

  async getRecommendations(profile: TasteProfile): Promise<AiRecommendation[]> {
    this.lastUsage = null
    const prompt = buildRecommendationPrompt(profile)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetchWithRetry(
        `${API_BASE}/${this.model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: sanitizeGeminiSchema(getAiRecommendationsJsonSchema()),
              maxOutputTokens: 4096,
            },
          }),
          signal: controller.signal,
        },
        { providerLabel: 'gemini' },
      )

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        usageMetadata?: {
          promptTokenCount?: number
          candidatesTokenCount?: number
        }
      }
      if (data.usageMetadata) {
        this.lastUsage = {
          provider: 'gemini',
          model: this.model,
          inputTokens: data.usageMetadata.promptTokenCount,
          outputTokens: data.usageMetadata.candidatesTokenCount,
        }
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) throw new Error('Empty response from Gemini')

      return validateAiRecommendations(JSON.parse(text))
    } finally {
      clearTimeout(timer)
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await fetch(`${API_BASE}/${this.model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
        signal: controller.signal,
      })

      if (res.ok) {
        return { success: true, message: `Connected to Gemini (${this.model})` }
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
