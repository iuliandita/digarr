import type { AiRecommendation, TasteProfile } from '@/core/types'

// Per-request token accounting surfaced by providers. Providers that do not
// return usage (e.g. OpenAI-compatible endpoints without token reporting)
// leave this undefined. Persisted to `job_runs.metadata` as `aiUsage`.
export type AiUsage = {
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
  /** Anthropic-specific: tokens read from the prompt cache. */
  cacheReadInputTokens?: number
  /** Anthropic-specific: tokens written to the prompt cache. */
  cacheCreationInputTokens?: number
}

export interface RecommendationProvider {
  getRecommendations(profile: TasteProfile): Promise<AiRecommendation[]>
  testConnection(): Promise<{ success: boolean; message: string }>
  /**
   * Usage reported by the most recent `getRecommendations` call, or null if
   * the call never ran or the provider does not surface usage. Read after a
   * successful call; providers reset this on each invocation.
   */
  readonly lastUsage?: AiUsage | null
}
