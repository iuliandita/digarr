import { describe, expect, test, vi } from 'vitest'

// Mock the provider modules to avoid real SDK instantiation
vi.mock('@/core/providers/anthropic', () => ({
  AnthropicProvider: vi.fn(function (this: Record<string, unknown>) {
    this._type = 'anthropic'
  }),
}))

vi.mock('@/core/providers/openai', () => ({
  OpenAIProvider: vi.fn(function (this: Record<string, unknown>) {
    this._type = 'openai'
  }),
}))

vi.mock('@/core/providers/ollama', () => ({
  OllamaProvider: vi.fn(function (this: Record<string, unknown>) {
    this._type = 'ollama'
  }),
}))

const { AiProviderRegistry, createDefaultRegistry } = await import('@/core/providers/registry')
const { AnthropicProvider } = await import('@/core/providers/anthropic')
const { OpenAIProvider } = await import('@/core/providers/openai')
const { OllamaProvider } = await import('@/core/providers/ollama')

describe('AiProviderRegistry', () => {
  test('register() and has() work correctly', () => {
    const registry = new AiProviderRegistry()
    const def = {
      id: 'test',
      name: 'Test',
      create: vi.fn().mockReturnValue({}),
    }
    expect(registry.has('test')).toBe(false)
    registry.register(def)
    expect(registry.has('test')).toBe(true)
  })

  test('availableIds() returns registered ids', () => {
    const registry = new AiProviderRegistry()
    registry.register({ id: 'a', name: 'A', create: vi.fn() })
    registry.register({ id: 'b', name: 'B', create: vi.fn() })
    expect(registry.availableIds()).toEqual(['a', 'b'])
  })

  test('create() calls the definition create function with config', async () => {
    const registry = new AiProviderRegistry()
    const mockProvider = { getRecommendations: vi.fn(), testConnection: vi.fn() }
    const createFn = vi.fn().mockResolvedValue(mockProvider)
    registry.register({ id: 'custom', name: 'Custom', create: createFn })

    const config = { apiKey: 'key', model: 'model-x', baseUrl: null }
    const result = await registry.create('custom', config)

    expect(createFn).toHaveBeenCalledWith(config)
    expect(result).toBe(mockProvider)
  })

  test('create() throws on unknown provider id', async () => {
    const registry = new AiProviderRegistry()
    await expect(registry.create('unknown-ai', { apiKey: null, model: 'x' })).rejects.toThrow(
      'Unknown AI provider: unknown-ai',
    )
  })

  test('create() throws on empty provider id', async () => {
    const registry = new AiProviderRegistry()
    await expect(registry.create('', { apiKey: null, model: 'model' })).rejects.toThrow(
      'Unknown AI provider:',
    )
  })
})

describe('createDefaultRegistry', () => {
  test('registers anthropic, openai, and ollama', () => {
    const registry = createDefaultRegistry()
    expect(registry.has('anthropic')).toBe(true)
    expect(registry.has('openai')).toBe(true)
    expect(registry.has('ollama')).toBe(true)
  })

  test('availableIds() returns all built-in providers', () => {
    const registry = createDefaultRegistry()
    expect(registry.availableIds().sort()).toEqual([
      'anthropic',
      'gemini',
      'ollama',
      'openai',
      'openai-compatible',
    ])
  })

  test('creates AnthropicProvider for "anthropic"', async () => {
    const registry = createDefaultRegistry()
    const provider = await registry.create('anthropic', {
      apiKey: 'sk-ant-key',
      model: 'claude-3-5-sonnet-20241022',
    })
    expect(AnthropicProvider).toHaveBeenCalledWith(
      'sk-ant-key',
      'claude-3-5-sonnet-20241022',
      undefined,
    )
    expect(provider).toBeDefined()
  })

  test('threads baseUrl into AnthropicProvider', async () => {
    const registry = createDefaultRegistry()
    await registry.create('anthropic', {
      apiKey: 'sk-ant-key',
      model: 'claude-3-5-sonnet-20241022',
      baseUrl: 'https://proxy.example.com',
    })
    expect(AnthropicProvider).toHaveBeenCalledWith(
      'sk-ant-key',
      'claude-3-5-sonnet-20241022',
      'https://proxy.example.com',
    )
  })

  test('creates OpenAIProvider for "openai"', async () => {
    const registry = createDefaultRegistry()
    const provider = await registry.create('openai', { apiKey: 'sk-openai-key', model: 'gpt-4o' })
    expect(OpenAIProvider).toHaveBeenCalledWith('sk-openai-key', 'gpt-4o', undefined)
    expect(provider).toBeDefined()
  })

  test('threads baseUrl into OpenAIProvider', async () => {
    const registry = createDefaultRegistry()
    await registry.create('openai', {
      apiKey: 'sk-openai-key',
      model: 'gpt-4o',
      baseUrl: 'https://proxy.example.com',
    })
    expect(OpenAIProvider).toHaveBeenCalledWith(
      'sk-openai-key',
      'gpt-4o',
      'https://proxy.example.com',
    )
  })

  test('creates OllamaProvider for "ollama"', async () => {
    const registry = createDefaultRegistry()
    const provider = await registry.create('ollama', {
      apiKey: null,
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
    })
    expect(OllamaProvider).toHaveBeenCalledWith('llama3', 'http://localhost:11434', undefined)
    expect(provider).toBeDefined()
  })

  test('threads timeoutSeconds into OllamaProvider', async () => {
    const registry = createDefaultRegistry()
    await registry.create('ollama', {
      apiKey: null,
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
      timeoutSeconds: 30,
    })
    expect(OllamaProvider).toHaveBeenCalledWith('llama3', 'http://localhost:11434', 30)
  })

  test('throws when anthropic is missing an API key', async () => {
    const registry = createDefaultRegistry()
    await expect(
      registry.create('anthropic', {
        apiKey: null,
        model: 'claude-3-5-sonnet-20241022',
      }),
    ).rejects.toThrow('Anthropic requires an API key')
  })

  test('throws when openai is missing an API key', async () => {
    const registry = createDefaultRegistry()
    await expect(registry.create('openai', { apiKey: null, model: 'gpt-4o' })).rejects.toThrow(
      'OpenAI requires an API key',
    )
  })

  test('throws when ollama is missing a base URL', async () => {
    const registry = createDefaultRegistry()
    await expect(
      registry.create('ollama', { apiKey: null, model: 'llama3', baseUrl: null }),
    ).rejects.toThrow('Ollama requires a base URL')
  })

  test('supports registering additional providers without modifying existing ones', () => {
    const registry = createDefaultRegistry()
    const mockCreate = vi.fn().mockReturnValue({})
    registry.register({ id: 'gemini', name: 'Gemini', create: mockCreate })
    expect(registry.has('gemini')).toBe(true)
    expect(registry.has('anthropic')).toBe(true)
    expect(registry.availableIds()).toContain('gemini')
  })
})
