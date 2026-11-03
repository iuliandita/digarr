import Anthropic from '@anthropic-ai/sdk'
import type { AiRecommendation, TasteProfile } from '@/core/types'
import { errMsg } from '@/core/validation'
import {
  buildRecommendationPrompt,
  buildRecommendationUserTurn,
  getAiRecommendationsJsonSchema,
  parseRecommendationResponse,
  RECOMMENDATION_SYSTEM_PRELUDE,
  validateAiRecommendations,
} from './prompt'
import { optionalTimeoutSecondsToMs } from './timeout'
import type { AiUsage, RecommendationProvider } from './types'

const RECOMMENDATION_TOOL_NAME = 'emit_recommendations'

// Claude Sonnet 5.5, Opus 5.5 and Fable 5.1 reject a forced tool_choice
// (`tool` or `any`) with a 400, so the tool is offered with `auto` and named
// in the system prompt instead. It also overrides the prelude's "return a
// JSON array" wording, which other providers still rely on.
const RECOMMENDATION_TOOL_INSTRUCTION = `Deliver your answer by calling the ${RECOMMENDATION_TOOL_NAME} tool exactly once, with the complete list in its recommendations array, instead of writing the JSON array as text.`

// Strict tool use answers length, range and item-count keywords with a 400
// and needs `additionalProperties: false` on every object. Derive that
// variant from the shared schema so the two cannot drift;
// validateAiRecommendations still enforces the bounds on the parsed input.
const STRICT_UNSUPPORTED_KEYWORDS = new Set([
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'multipleOf',
  'minItems',
  'maxItems',
])

function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema)
  if (!node || typeof node !== 'object') return node
  const strict: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (STRICT_UNSUPPORTED_KEYWORDS.has(key)) continue
    strict[key] =
      key === 'properties' && value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).map(([name, child]) => [name, toStrictSchema(child)]),
          )
        : toStrictSchema(value)
  }
  if (strict.type === 'object') strict.additionalProperties = false
  return strict
}

const RECOMMENDATION_INPUT_SCHEMA = toStrictSchema(
  getAiRecommendationsJsonSchema(),
) as Anthropic.Tool.InputSchema

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

export class AnthropicProvider implements RecommendationProvider {
  private client: Anthropic
  private model: string
  lastUsage: AiUsage | null = null

  constructor(
    apiKey: string,
    model: string = DEFAULT_MODEL,
    baseUrl?: string | null,
    timeoutSeconds?: number | null,
  ) {
    const timeoutMs = optionalTimeoutSecondsToMs(timeoutSeconds)
    this.client = new Anthropic({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    })
    this.model = model
  }

  async getRecommendations(profile: TasteProfile): Promise<AiRecommendation[]> {
    this.lastUsage = null

    // When the caller supplied a pre-built prompt (quick-discover, mood) we
    // skip the split because there is no cacheable prelude to reuse.
    const useCachedPrelude = !profile._rawPrompt
    const userContent = useCachedPrelude
      ? buildRecommendationUserTurn(profile)
      : buildRecommendationPrompt(profile)

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: 4096,
      system: [
        ...(useCachedPrelude
          ? [
              // System blocks support `cache_control: { type: 'ephemeral' }`.
              // The first request writes the cache; subsequent requests within
              // the 5-minute TTL read from it at ~10% of input-token cost.
              {
                type: 'text' as const,
                text: RECOMMENDATION_SYSTEM_PRELUDE,
                cache_control: { type: 'ephemeral' as const },
              },
            ]
          : []),
        { type: 'text', text: RECOMMENDATION_TOOL_INSTRUCTION },
      ],
      messages: [{ role: 'user', content: userContent }],
      tools: [
        {
          name: RECOMMENDATION_TOOL_NAME,
          description:
            'Emit the structured recommendation list. Call this tool exactly once with the complete array of recommendations.',
          strict: true,
          input_schema: RECOMMENDATION_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    }

    const response = await this.createMessage(params)
    try {
      return readRecommendations(response)
    } catch (err) {
      // `auto` does not guarantee the tool call. When the reply has neither
      // the call nor a parseable array, ask once more before giving up.
      if (response.content.some((block) => block.type === 'tool_use')) throw err
      return readRecommendations(await this.createMessage(params))
    }
  }

  private async createMessage(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> {
    const response = await this.client.messages.create(params)
    this.lastUsage = addUsage(this.lastUsage, extractUsage(this.model, response.usage))
    return response
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

function readRecommendations(response: Anthropic.Message): AiRecommendation[] {
  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (toolUse && toolUse.type === 'tool_use') {
    return validateAiRecommendations(toolUse.input)
  }

  // Fallback: some proxy deployments drop tool_use support - parse a text
  // block as a JSON array the old way. Models that think by default put
  // thinking blocks ahead of it.
  const text = response.content.find((block) => block.type === 'text')
  if (text?.type !== 'text') {
    throw new Error('Unexpected response format from Anthropic API')
  }
  return parseRecommendationResponse(text.text)
}

// A retried request is billed too, so job history gets the sum.
function addUsage(total: AiUsage | null, usage: AiUsage | null): AiUsage | null {
  if (!total || !usage) return usage ?? total
  const sum = (a?: number, b?: number) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)
  return {
    ...usage,
    inputTokens: sum(total.inputTokens, usage.inputTokens),
    outputTokens: sum(total.outputTokens, usage.outputTokens),
    cacheReadInputTokens: sum(total.cacheReadInputTokens, usage.cacheReadInputTokens),
    cacheCreationInputTokens: sum(total.cacheCreationInputTokens, usage.cacheCreationInputTokens),
  }
}

function extractUsage(
  model: string,
  usage: Anthropic.Messages.Usage | null | undefined,
): AiUsage | null {
  if (!usage) return null
  return {
    provider: 'anthropic',
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
  }
}
