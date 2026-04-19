// @vitest-environment node

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { SearchSourceDescriptor } from '@/core/search/catalog'
import type { MergedSearchResult } from '@/core/search/multi-source'
import { type SearchDeps, searchRoutes } from '@/server/routes/search'

function makeResult(name: string): MergedSearchResult {
  return {
    name,
    images: [],
    genres: [],
    sources: [{ id: 'test' }],
    inLibrary: false,
    inRecommendations: false,
  }
}

function makeDeps(overrides: Partial<SearchDeps> = {}): SearchDeps {
  return {
    listSources: vi.fn().mockResolvedValue([] satisfies SearchSourceDescriptor[]),
    search: vi.fn().mockResolvedValue([makeResult('Portishead'), makeResult('Massive Attack')]),
    ...overrides,
  }
}

describe('GET /api/v1/search/sources', () => {
  it('returns source metadata from the deps', async () => {
    const listSources = vi.fn().mockResolvedValue([
      { id: 'deezer', label: 'Deezer', available: true },
      {
        id: 'spotify',
        label: 'Spotify',
        available: false,
        reason: 'Connect Spotify in Settings to enable search.',
      },
    ] satisfies SearchSourceDescriptor[])
    const app = new Hono()
    app.route('/', searchRoutes(makeDeps({ listSources })))

    const res = await app.request('/api/v1/search/sources')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sources: SearchSourceDescriptor[] }
    expect(body.sources).toHaveLength(2)
    expect(listSources).toHaveBeenCalled()
  })
})

describe('GET /api/v1/search', () => {
  it('returns 400 when q is missing', async () => {
    const app = new Hono()
    app.route('/', searchRoutes(makeDeps()))

    const res = await app.request('/api/v1/search')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/q parameter/)
  })

  it('returns 400 when q is empty string', async () => {
    const app = new Hono()
    app.route('/', searchRoutes(makeDeps()))

    const res = await app.request('/api/v1/search?q=')
    expect(res.status).toBe(400)
  })

  it('returns 400 when q is whitespace only', async () => {
    const app = new Hono()
    app.route('/', searchRoutes(makeDeps()))

    const res = await app.request('/api/v1/search?q=%20%20')
    expect(res.status).toBe(400)
  })

  it('returns results from search function', async () => {
    const app = new Hono()
    app.route('/', searchRoutes(makeDeps()))

    const res = await app.request('/api/v1/search?q=portishead')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: MergedSearchResult[] }
    expect(body.results).toHaveLength(2)
    expect(body.results[0]?.name).toBe('Portishead')
  })

  it('passes limit param through', async () => {
    const searchFn = vi.fn().mockResolvedValue([makeResult('Artist')])
    const app = new Hono()
    app.route('/', searchRoutes(makeDeps({ search: searchFn })))

    await app.request('/api/v1/search?q=test&limit=5')
    expect(searchFn).toHaveBeenCalledWith('test', expect.objectContaining({ limit: 5 }))
  })

  it('caps limit at 50', async () => {
    const searchFn = vi.fn().mockResolvedValue([])
    const app = new Hono()
    app.route('/', searchRoutes(makeDeps({ search: searchFn })))

    await app.request('/api/v1/search?q=test&limit=999')
    expect(searchFn).toHaveBeenCalledWith('test', expect.objectContaining({ limit: 50 }))
  })

  it('clamps limit to 1 when zero is provided', async () => {
    const searchFn = vi.fn().mockResolvedValue([])
    const app = new Hono()
    app.route('/', searchRoutes(makeDeps({ search: searchFn })))

    await app.request('/api/v1/search?q=test&limit=0')
    expect(searchFn).toHaveBeenCalledWith('test', expect.objectContaining({ limit: 1 }))
  })

  it('clamps limit to 1 when a negative value is provided', async () => {
    const searchFn = vi.fn().mockResolvedValue([])
    const app = new Hono()
    app.route('/', searchRoutes(makeDeps({ search: searchFn })))

    await app.request('/api/v1/search?q=test&limit=-5')
    expect(searchFn).toHaveBeenCalledWith('test', expect.objectContaining({ limit: 1 }))
  })

  it('defaults limit to 20 when not provided', async () => {
    const searchFn = vi.fn().mockResolvedValue([])
    const app = new Hono()
    app.route('/', searchRoutes(makeDeps({ search: searchFn })))

    await app.request('/api/v1/search?q=test')
    expect(searchFn).toHaveBeenCalledWith('test', expect.objectContaining({ limit: 20 }))
  })

  it('passes sources param through as array', async () => {
    const searchFn = vi.fn().mockResolvedValue([])
    const app = new Hono()
    app.route('/', searchRoutes(makeDeps({ search: searchFn })))

    await app.request('/api/v1/search?q=test&sources=spotify,deezer')
    expect(searchFn).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ sources: ['spotify', 'deezer'] }),
    )
  })

  it('handles search errors with 500', async () => {
    const app = new Hono()
    app.route(
      '/',
      searchRoutes(
        makeDeps({
          search: vi.fn().mockRejectedValue(new Error('upstream failure')),
        }),
      ),
    )

    const res = await app.request('/api/v1/search?q=test')
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Search failed')
  })
})
