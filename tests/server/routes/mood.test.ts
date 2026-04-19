// @vitest-environment node

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { type MoodDeps, moodRoutes } from '@/server/routes/mood'

function makeDeps(overrides: Partial<MoodDeps> = {}): MoodDeps {
  return {
    getSettings: vi.fn().mockResolvedValue({
      aiProvider: 'openai',
      aiModel: 'gpt-4o-mini',
      aiApiKey: 'test-key',
      aiBaseUrl: null,
    }),
    providerRegistry: {
      create: vi.fn().mockResolvedValue({
        getRecommendations: vi.fn().mockResolvedValue([
          {
            artistName: 'Grouper',
            reasoning: 'Ambient folk artist known for hazy textures.',
            confidence: 0.87,
            genres: ['ambient', 'drone'],
            suggestedAlbum: 'Dragging a Dead Deer Up a Hill',
          },
        ]),
        testConnection: vi.fn(),
      }),
    } as unknown as MoodDeps['providerRegistry'],
    ...overrides,
  }
}

describe('POST /api/v1/mood/discover', () => {
  it('returns AI recommendations for mood query', async () => {
    const deps = makeDeps()
    const app = new Hono()
    app.route('/', moodRoutes(deps))

    const res = await app.request('/api/v1/mood/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'dark ambient with field recordings' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: unknown[] }
    expect(body.results).toHaveLength(1)
  })

  it('rejects empty query', async () => {
    const app = new Hono()
    app.route('/', moodRoutes(makeDeps()))

    const res = await app.request('/api/v1/mood/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects when AI provider not configured', async () => {
    const app = new Hono()
    app.route(
      '/',
      moodRoutes(
        makeDeps({
          getSettings: vi.fn().mockResolvedValue({ aiProvider: null, aiModel: null }),
        }),
      ),
    )

    const res = await app.request('/api/v1/mood/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'chill vibes' }),
    })
    expect(res.status).toBe(400)
  })

  it('passes responseLocale into the AI prompt builder', async () => {
    const getRecommendations = vi.fn().mockResolvedValue([
      {
        artistName: 'Grouper',
        reasoning: 'Ambient folk artist known for hazy textures.',
        confidence: 0.87,
        genres: ['ambient', 'drone'],
        suggestedAlbum: 'Dragging a Dead Deer Up a Hill',
      },
    ])
    const app = new Hono()
    app.route(
      '/',
      moodRoutes(
        makeDeps({
          providerRegistry: {
            create: vi.fn().mockResolvedValue({
              getRecommendations,
              testConnection: vi.fn(),
            }),
          } as unknown as MoodDeps['providerRegistry'],
        }),
      ),
    )

    await app.request('/api/v1/mood/discover', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Digarr-Locale': 'es',
      },
      body: JSON.stringify({ query: 'jazz nocturno' }),
    })

    expect(getRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({
        responseLocale: 'es',
        promptLocale: 'es',
      }),
    )
  })

  it('keeps responseLocale on the resolved UI locale when promptLocale differs', async () => {
    const getRecommendations = vi.fn().mockResolvedValue([
      {
        artistName: 'Grouper',
        reasoning: 'Ambient folk artist known for hazy textures.',
        confidence: 0.87,
        genres: ['ambient', 'drone'],
        suggestedAlbum: 'Dragging a Dead Deer Up a Hill',
      },
    ])
    const app = new Hono()
    app.route(
      '/',
      moodRoutes(
        makeDeps({
          providerRegistry: {
            create: vi.fn().mockResolvedValue({
              getRecommendations,
              testConnection: vi.fn(),
            }),
          } as unknown as MoodDeps['providerRegistry'],
        }),
      ),
    )

    await app.request('/api/v1/mood/discover', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Digarr-Locale': 'fr',
      },
      body: JSON.stringify({ query: 'jazz nocturno' }),
    })

    expect(getRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({
        responseLocale: 'fr',
        promptLocale: 'es',
      }),
    )
  })
})
