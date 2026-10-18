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

vi.mock('@/core/providers/gemini', () => ({
  GeminiProvider: vi.fn(function (this: Record<string, unknown>) {
    this._type = 'gemini'
  }),
}))

vi.mock('@/core/providers/openai-compatible', () => ({
  OpenAICompatibleProvider: vi.fn(function (this: Record<string, unknown>) {
    this._type = 'openai-compatible'
  }),
}))

const { AiProviderRegistry, createDefaultRegistry } = await import('@/core/providers/registry')
const { AnthropicProvider } = await import('@/core/providers/anthropic')
const { OpenAIProvider } = await import('@/core/providers/openai')
const { OllamaProvider } = await import('@/core/providers/ollama')
const { GeminiProvider } = await import('@/core/providers/gemini')
const { OpenAICompatibleProvider } = await import('@/core/providers/openai-compatible')

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

  const ANT = { apiKey: 'sk-ant-key', model: 'claude-3-5-sonnet-20241022' }
  const OAI = { apiKey: 'sk-openai-key', model: 'gpt-4o' }
  const OLL = { apiKey: null, model: 'llama3', baseUrl: 'http://localhost:11434' }
  const PROXY = 'https://proxy.example.com'

  test.each([
    ['anthropic', () => AnthropicProvider, ANT, ['sk-ant-key', ANT.model, undefined, undefined]],
    [
      'anthropic',
      () => AnthropicProvider,
      { ...ANT, baseUrl: PROXY },
      ['sk-ant-key', ANT.model, PROXY, undefined],
    ],
    [
      'anthropic',
      () => AnthropicProvider,
      { ...ANT, timeoutSeconds: 45 },
      ['sk-ant-key', ANT.model, undefined, 45],
    ],
    ['openai', () => OpenAIProvider, OAI, ['sk-openai-key', 'gpt-4o', undefined, undefined]],
    [
      'openai',
      () => OpenAIProvider,
      { ...OAI, baseUrl: PROXY },
      ['sk-openai-key', 'gpt-4o', PROXY, undefined],
    ],
    [
      'openai',
      () => OpenAIProvider,
      { ...OAI, timeoutSeconds: 45 },
      ['sk-openai-key', 'gpt-4o', undefined, 45],
    ],
    ['ollama', () => OllamaProvider, OLL, ['llama3', 'http://localhost:11434', undefined]],
    [
      'ollama',
      () => OllamaProvider,
      { ...OLL, timeoutSeconds: 30 },
      ['llama3', 'http://localhost:11434', 30],
    ],
    [
      'gemini',
      () => GeminiProvider,
      { apiKey: 'gemini-key', model: 'gemini-3-flash-preview', timeoutSeconds: 45 },
      ['gemini-key', 'gemini-3-flash-preview', 45],
    ],
    [
      'openai-compatible',
      () => OpenAICompatibleProvider,
      {
        apiKey: 'compat-key',
        model: 'local-model',
        baseUrl: 'http://localhost:8080',
        timeoutSeconds: 45,
      },
      ['http://localhost:8080', 'local-model', 'compat-key', 45],
    ],
  ] as const)('maps %s config to constructor arguments', async (id, ctor, config, args) => {
    const provider = await createDefaultRegistry().create(id, { ...config })
    expect(ctor()).toHaveBeenCalledWith(...args)
    expect(provider).toBeDefined()
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
})
