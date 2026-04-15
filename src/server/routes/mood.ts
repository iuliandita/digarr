import { Hono } from 'hono'
import { createLidarrClient } from '@/core/clients/lidarr'
import { detectPromptLocale } from '@/core/i18n/prompt-locale'
import { buildMoodPrompt } from '@/core/providers/prompt'
import type { AiProviderRegistry } from '@/core/providers/registry'
import { resolveRequestLocale } from '@/server/locale'
import type { HonoEnv } from '@/server/types'

export type MoodDeps = {
  getSettings: () => Promise<Record<string, unknown> | null>
  getUserById?: (id: number) => Promise<{ preferredLocale?: string | null } | null>
  providerRegistry: AiProviderRegistry
}

export function moodRoutes(deps: MoodDeps) {
  const router = new Hono<HonoEnv>()

  router.post('/api/mood/discover', async (c) => {
    const body = await c.req.json()
    const { query } = body as { query?: string }
    const trimmedQuery = query?.trim()

    if (!trimmedQuery) {
      return c.json({ error: 'query is required' }, 400)
    }
    if (trimmedQuery.length > 500) {
      return c.json({ error: 'query must be 500 characters or less' }, 400)
    }

    const settings = await deps.getSettings()
    if (!settings) {
      return c.json({ error: 'Settings not configured' }, 400)
    }

    const { aiProvider, aiModel, aiApiKey, aiBaseUrl } = settings as Record<string, string | null>
    if (!aiProvider || !aiModel) {
      return c.json({ error: 'AI provider not configured' }, 400)
    }

    const provider = await deps.providerRegistry.create(aiProvider, {
      apiKey: aiApiKey ?? null,
      model: aiModel,
      baseUrl: aiBaseUrl ?? null,
    })

    const userId = c.get('userId')
    const user = userId && deps.getUserById ? await deps.getUserById(userId) : null
    const uiLocale = resolveRequestLocale({
      userPreferredLocale: user?.preferredLocale,
      requestLocale: c.req.header('X-Digarr-Locale'),
      acceptLanguage: c.req.header('Accept-Language'),
    })
    const promptLocale = detectPromptLocale(trimmedQuery)
    const responseLocale = uiLocale
    const prompt = buildMoodPrompt(trimmedQuery, [], responseLocale)
    const recs = await provider.getRecommendations({
      topArtists: [],
      topGenres: [],
      listeningPatterns: { totalListens: 0, recentTrend: 'stable' },
      responseLocale,
      promptLocale,
      _rawPrompt: prompt,
    })

    // Check which results are already in the user's Lidarr library
    let libraryNames = new Set<string>()
    const { lidarrUrl, lidarrApiKey, skipTlsVerify } = settings as Record<string, unknown>
    if (lidarrUrl && lidarrApiKey) {
      try {
        const lidarr = createLidarrClient(
          lidarrUrl as string,
          lidarrApiKey as string,
          (skipTlsVerify as boolean) ?? false,
        )
        const artists = await lidarr.getArtists()
        libraryNames = new Set(artists.map((a) => a.artistName.toLowerCase()))
      } catch {
        // Lidarr unavailable - skip library check
      }
    }

    const results = recs.map((r) => ({
      ...r,
      inLibrary: libraryNames.has(r.artistName.toLowerCase()),
    }))

    return c.json({ results })
  })

  return router
}
