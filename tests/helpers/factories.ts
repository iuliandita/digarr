let nextId = 1000

export function makeRecommendation(overrides: Record<string, unknown> = {}) {
  const id = nextId++
  return {
    id,
    score: 0.75,
    status: 'pending',
    sources: { lastfm: 0.8 },
    aiReasoning: null,
    lidarrError: null,
    artist: {
      id: nextId++,
      name: `Artist ${id}`,
      mbid: `mbid-${id}`,
      genres: ['rock'],
      imageUrl: null,
      streamingUrls: null,
    },
    createdAt: new Date().toISOString(),
    actedOnAt: null,
    ...overrides,
  }
}

export function makeSubscription(overrides: Record<string, unknown> = {}) {
  const id = nextId++
  return {
    id,
    name: `Sub ${id}`,
    userId: 1,
    enabled: true,
    sourceType: 'lastfm',
    sourceProvider: 'lastfm',
    sourceConfig: {},
    maxArtistsPerRun: 20,
    cron: '0 0 * * 0',
    lastRunAt: null,
    lastResultCount: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}
