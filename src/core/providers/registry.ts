import type { RecommendationProvider } from './types'

export type AiProviderConfig = {
  apiKey: string | null
  model: string
  baseUrl?: string | null
  timeoutSeconds?: number | null
}

export type AiProviderDefinition = {
  id: string
  name: string
  create: (config: AiProviderConfig) => RecommendationProvider | Promise<RecommendationProvider>
}

export class AiProviderRegistry {
  private providers = new Map<string, AiProviderDefinition>()

  register(definition: AiProviderDefinition): void {
    this.providers.set(definition.id, definition)
  }

  async create(id: string, config: AiProviderConfig): Promise<RecommendationProvider> {
    const definition = this.providers.get(id)
    if (!definition) {
      throw new Error(`Unknown AI provider: ${id}`)
    }
    return definition.create(config)
  }

  has(id: string): boolean {
    return this.providers.has(id)
  }

  availableIds(): string[] {
    return [...this.providers.keys()]
  }
}

export function createDefaultRegistry(): AiProviderRegistry {
  const registry = new AiProviderRegistry()

  registry.register({
    id: 'anthropic',
    name: 'Anthropic',
    async create({ apiKey, model, baseUrl }) {
      const { AnthropicProvider } = await import('./anthropic')
      if (!apiKey) throw new Error('Anthropic requires an API key')
      return new AnthropicProvider(apiKey, model, baseUrl)
    },
  })

  registry.register({
    id: 'openai',
    name: 'OpenAI',
    async create({ apiKey, model, baseUrl }) {
      const { OpenAIProvider } = await import('./openai')
      if (!apiKey) throw new Error('OpenAI requires an API key')
      return new OpenAIProvider(apiKey, model, baseUrl)
    },
  })

  registry.register({
    id: 'ollama',
    name: 'Ollama',
    async create({ model, baseUrl, timeoutSeconds }) {
      const { OllamaProvider } = await import('./ollama')
      if (!baseUrl) throw new Error('Ollama requires a base URL')
      return new OllamaProvider(model, baseUrl, timeoutSeconds ?? undefined)
    },
  })

  registry.register({
    id: 'gemini',
    name: 'Google Gemini',
    async create({ apiKey, model }) {
      const { GeminiProvider } = await import('./gemini')
      if (!apiKey) throw new Error('Gemini requires an API key')
      return new GeminiProvider(apiKey, model)
    },
  })

  registry.register({
    id: 'openai-compatible',
    name: 'OpenAI-Compatible',
    async create({ apiKey, model, baseUrl }) {
      const { OpenAICompatibleProvider } = await import('./openai-compatible')
      if (!baseUrl) throw new Error('OpenAI-Compatible requires a base URL')
      return new OpenAICompatibleProvider(baseUrl, model, apiKey)
    },
  })

  return registry
}
