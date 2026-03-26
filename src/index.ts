import { serve } from '@hono/node-server'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { canAutoSetup, envConfig } from './config/env'
import { hashPassword } from './core/auth'
import { OidcService } from './core/auth/oidc'
import { createBandcampClient } from './core/clients/bandcamp'
import { createDeezerClient } from './core/clients/deezer'
import { createJellyfinClient } from './core/clients/jellyfin'
import { createLidarrClient } from './core/clients/lidarr'
import { createMusicBrainzClient } from './core/clients/musicbrainz'
import { initEncryption, isEncryptionEnabled } from './core/crypto'
import { GenreService } from './core/genre/service'
import { LibraryHealthService } from './core/library/health'
import { SkyHookWarmer } from './core/library/skyhook-warmer'
import { PipelineOrchestrator } from './core/pipeline/orchestrator'
import type { StoreDb } from './core/pipeline/store'
import { SubscriptionScheduler } from './core/pipeline/subscription-scheduler'
import { generatePlaylist } from './core/playlists/generator'
import { PlaylistScheduler } from './core/playlists/scheduler'
import { buildStrategyDeps } from './core/playlists/strategy-deps'
import { createDiscogsSource } from './core/plugins/discogs'
import { createLastFmSource } from './core/plugins/lastfm'
import { createListenBrainzSource } from './core/plugins/listenbrainz'
import { SourceRegistry } from './core/plugins/registry'
import { createDefaultRegistry } from './core/providers/registry'
import { buildSearchSourceCatalog } from './core/search/catalog'
import type { SearchSource } from './core/search/multi-source'
import { multiSourceSearch } from './core/search/multi-source'
import { createBandcampSearchSource } from './core/search/sources/bandcamp'
import { createDeezerSearchSource } from './core/search/sources/deezer'
import { createMusicBrainzSearchSource } from './core/search/sources/musicbrainz'
import { createSpotifySearchSource } from './core/search/sources/spotify'
import { setSessionStore } from './core/sessions'
import { resolveSpotifyToken } from './core/spotify-auth'
import { createGenreAdapter } from './core/subscriptions/adapters/genre'
import { createLastfmChartsAdapter } from './core/subscriptions/adapters/lastfm-charts'
import { createLastfmTagAdapter } from './core/subscriptions/adapters/lastfm-tag'
import { createListenBrainzAdapter } from './core/subscriptions/adapters/listenbrainz'
import { createSimilarAdapter } from './core/subscriptions/adapters/similar'
import { createSpotifyChartsAdapter } from './core/subscriptions/adapters/spotify-charts'
import { createSpotifyPlaylistAdapter } from './core/subscriptions/adapters/spotify-playlist'
import { resolveSubscriptionSourceConnections } from './core/subscriptions/connections'
import { AdapterRegistry } from './core/subscriptions/registry'
import { runSubscription } from './core/subscriptions/runner'
import type {
  MusicBrainzClient as SubMBClient,
  SubscriptionConfig,
} from './core/subscriptions/types'
import { createJellyfinPlaylistTarget } from './core/targets/jellyfin-playlist'
import { createLidarrTarget } from './core/targets/lidarr'
import { createNavidromePlaylistTarget } from './core/targets/navidrome-playlist'
import { createPlexPlaylistTarget } from './core/targets/plex-playlist'
import { createSpotifyPlaylistTarget } from './core/targets/spotify-playlist'
import { db, pool } from './db'
import { getPopularityMap, lookupByName } from './db/queries/artist-metadata'
import { getArtistById, upsertArtist } from './db/queries/artists'
import { completeBatch, getBatch, listBatches } from './db/queries/batches'
import { getRecentActivity, getTopGenresForUser } from './db/queries/dashboard'
import {
  getAllGenres,
  getChildGenres,
  getGenreBySlug,
  searchGenres,
  upsertGenre,
} from './db/queries/genres'
import { getOAuthToken } from './db/queries/oauth-tokens'
import {
  getPlaylistsDueForGeneration,
  replacePlaylistTracks,
  updatePlaylist as updatePlaylistRow,
} from './db/queries/playlists'
import {
  bulkUpdateStatus,
  filterOwnedIds,
  getGenreFeedbackHistory,
  getRecommendation,
  getRejectedArtistMbids,
  insertRecommendation,
  listRecommendations,
  updateRecommendationStatus,
} from './db/queries/recommendations'
import { sessionQueries } from './db/queries/sessions'
import type { SetupConfig } from './db/queries/settings'
import { completeSetup, getSettings, isSetupComplete, updateSettings } from './db/queries/settings'
import {
  completeRun,
  createSubscription,
  deleteSubscription,
  getEnabledSubscriptions,
  getRunsForSubscription,
  getSubscription,
  getSubscriptionsByUser,
  insertRun,
  updateSubscription,
} from './db/queries/subscriptions'
import type { TargetInsert } from './db/queries/targets'
import {
  createTarget,
  deleteTarget,
  getAllTargets,
  getTarget,
  getTargetsByType,
  getTargetsByUser,
  updateTarget,
} from './db/queries/targets'
import {
  createUser,
  deleteUser,
  getUserByEmail,
  getUserById,
  getUserByOidcSubject,
  getUserByUsername,
  getUserConnections,
  getUserCount,
  listUsers,
  updatePassword,
  updateUser,
} from './db/queries/users'
import {
  artists,
  DEFAULT_PREFERENCES,
  mergePreferences,
  recommendationBatches,
  recommendations,
} from './db/schema'
import { createApp } from './server'

// Initialize encryption before any DB operations.
initEncryption(envConfig.encryptionKey)
if (isEncryptionEnabled()) {
  console.log('Field-level encryption enabled')
} else {
  console.log('Field-level encryption disabled (set DIGARR_ENCRYPTION_KEY to enable)')
}

// Run pending database migrations before anything else.
// Uses drizzle-orm's programmatic migrator -- safe to run every boot (idempotent).
await migrate(db, { migrationsFolder: './drizzle' })
console.log('Database migrations applied')

// Wire up DB-backed session store after migrations are applied.
setSessionStore(sessionQueries(db))

const storeDb: StoreDb = {
  getExistingRecommendationMbids: async () => {
    const rows = await db
      .select({ mbid: artists.mbid })
      .from(recommendations)
      .innerJoin(artists, eq(recommendations.artistId, artists.id))
    return new Set(rows.map((r) => r.mbid))
  },
  insertBatch: async (data) => {
    const rows = await db
      .insert(recommendationBatches)
      .values({
        status: data.status,
        stats: data.stats,
        subscriptionId: data.subscriptionId ?? null,
      })
      .returning({ id: recommendationBatches.id })
    const row = rows[0]
    if (!row) throw new Error('insertBatch: no row returned')
    return row
  },
  completeBatch: async (id, stats) => {
    await completeBatch(db, id, { ...stats, filtered: 0, scored: 0 })
  },
  upsertArtist: async (data) => {
    const row = await upsertArtist(db, data)
    return { id: row.id }
  },
  insertRecommendation: (data) => insertRecommendation(db, data),
  getRejectedMbids: (cooldownDays) => getRejectedArtistMbids(db, cooldownDays),
  getFeedbackHistory: () => getGenreFeedbackHistory(db),
  lookupArtistMetadata: (name) => lookupByName(db, name),
  getPopularityMap: () => getPopularityMap(db),
}

const orchestrator = new PipelineOrchestrator()
const scheduler = new SubscriptionScheduler()
const playlistScheduler = new PlaylistScheduler()
const providerRegistry = createDefaultRegistry()

// Map DB genre rows (artistCount: number | null) to GenreInfo (artistCount: number)
function mapGenreRow(row: Awaited<ReturnType<typeof upsertGenre>>) {
  return { ...row, artistCount: row.artistCount ?? 0 }
}

const genreService = new GenreService({
  genreQueries: {
    upsertGenre: async (data) => mapGenreRow(await upsertGenre(db, data)),
    getGenreBySlug: async (slug) => {
      const row = await getGenreBySlug(db, slug)
      return row ? mapGenreRow(row) : null
    },
    getChildGenres: async (parentId) => {
      const rows = await getChildGenres(db, parentId)
      return rows.map(mapGenreRow)
    },
    searchGenres: async (query, limit) => {
      const rows = await searchGenres(db, query, limit)
      return rows.map(mapGenreRow)
    },
    getAllGenres: async () => {
      const rows = await getAllGenres(db)
      return rows.map(mapGenreRow)
    },
  },
})

// LibraryHealthService uses a lazy Lidarr client that reads current settings per call.
// This avoids the chicken-and-egg problem of needing settings at construction time.
function makeLazyLidarrClient() {
  async function getClient() {
    const s = await getSettings(db)
    if (s?.lidarrUrl && s?.lidarrApiKey) {
      return createLidarrClient(s.lidarrUrl, s.lidarrApiKey, s.skipTlsVerify ?? false)
    }
    return null
  }

  return {
    getArtists: async () => (await getClient())?.getArtists() ?? [],
    getAlbums: async (artistId: number) => (await getClient())?.getAlbums(artistId) ?? [],
    lookupArtist: async (term: string) => (await getClient())?.lookupArtist(term) ?? [],
    updateArtist: async (
      id: number,
      data: Parameters<ReturnType<typeof createLidarrClient>['updateArtist']>[1],
    ) => {
      const client = await getClient()
      if (!client) throw new Error('Lidarr not configured')
      return client.updateArtist(id, data)
    },
    triggerCommand: async (name: string, body?: Record<string, unknown>) => {
      const client = await getClient()
      if (!client) throw new Error('Lidarr not configured')
      return client.triggerCommand(name, body)
    },
    getRootFolders: async () => (await getClient())?.getRootFolders() ?? [],
  }
}

const lazyLidarrClient = makeLazyLidarrClient()

const libraryHealth = new LibraryHealthService({
  lidarrClient: lazyLidarrClient,
  artistCache: {
    getAll: async () => db.select().from(artists),
    updateImageUrl: async (mbid, imageUrl) => {
      await db.update(artists).set({ imageUrl }).where(eq(artists.mbid, mbid))
    },
  },
})

const skyhookWarmer = new SkyHookWarmer({ lookupArtist: lazyLidarrClient.lookupArtist })

const runPipeline = async () => {
  const currentSettings = await getSettings(db)
  if (currentSettings) {
    await orchestrator.run({ db: storeDb, settings: currentSettings, providerRegistry })
  }
}

// Shared subscription query facade (used both by routes and scheduler)
const subscriptionQueriesImpl = {
  createSubscription: (data: Parameters<typeof createSubscription>[1]) =>
    createSubscription(db, data),
  getSubscription: (id: number) => getSubscription(db, id),
  getSubscriptionsByUser: (userId: number) => getSubscriptionsByUser(db, userId),
  getEnabledSubscriptions: () => getEnabledSubscriptions(db),
  updateSubscription: (id: number, data: Parameters<typeof updateSubscription>[2]) =>
    updateSubscription(db, id, data),
  deleteSubscription: (id: number) => deleteSubscription(db, id),
  getRunsForSubscription: (id: number, limit?: number) => getRunsForSubscription(db, id, limit),
  insertRun: (data: Parameters<typeof insertRun>[1]) => insertRun(db, data),
  completeRun: (id: number, data: Parameters<typeof completeRun>[2]) => completeRun(db, id, data),
}

// Cache adapter registries per user -- building one per execution is redundant when
// multiple subscriptions fire on the same schedule for the same user.
// TTL is short (60s) so credential changes (e.g. new OAuth token) take effect quickly.
const adapterRegistryCache = new Map<string, { registry: AdapterRegistry; builtAt: number }>()
const ADAPTER_CACHE_TTL = 60_000

function getCachedAdapterRegistry(userId: number | null): AdapterRegistry | null {
  const key = String(userId ?? 'anon')
  const cached = adapterRegistryCache.get(key)
  if (cached && Date.now() - cached.builtAt < ADAPTER_CACHE_TTL) return cached.registry
  return null
}

function setCachedAdapterRegistry(userId: number | null, registry: AdapterRegistry): void {
  const key = String(userId ?? 'anon')
  adapterRegistryCache.set(key, { registry, builtAt: Date.now() })
}

async function executeSubscription(subscriptionId: number): Promise<void> {
  const sub = await getSubscription(db, subscriptionId)
  if (!sub) {
    console.warn(`[subscription-runner] Subscription ${subscriptionId} not found -- skipping`)
    return
  }

  const settings = await getSettings(db)
  const prefs = mergePreferences(settings?.preferences)

  const lidarrClient =
    settings?.lidarrUrl && settings?.lidarrApiKey
      ? createLidarrClient(
          settings.lidarrUrl,
          settings.lidarrApiKey,
          settings.skipTlsVerify ?? false,
        )
      : null

  const rejectedMbids = await storeDb.getRejectedMbids(prefs.rejectionCooldownDays)
  const feedbackHistory = await storeDb.getFeedbackHistory()

  const userConns = sub.userId ? await getUserConnections(db, sub.userId) : null
  const { lbUsername, lbToken, lfUsername, lfApiKey } = resolveSubscriptionSourceConnections(
    settings,
    userConns,
  )
  const dcToken = userConns?.discogsToken ?? null
  const dcUsername = userConns?.discogsUsername ?? null

  // Build source registry fresh per run (same pattern as orchestrator)
  const sourceRegistry = new SourceRegistry()
  if (lbUsername && lbToken) {
    sourceRegistry.register(createListenBrainzSource(lbUsername, lbToken))
  }
  if (lfUsername && lfApiKey) {
    sourceRegistry.register(createLastFmSource(lfUsername, lfApiKey))
  }
  if (dcToken && dcUsername) {
    sourceRegistry.register(createDiscogsSource(dcToken, dcUsername))
  }

  // Build adapter registry from available sources, or reuse a cached one.
  // Cache is keyed by userId with a 60s TTL -- short enough that credential
  // changes take effect quickly, long enough to avoid rebuilding for every
  // subscription when many fire on the same schedule for the same user.
  const userId = sub.userId
  let adapterRegistry = getCachedAdapterRegistry(userId ?? null)

  if (!adapterRegistry) {
    adapterRegistry = new AdapterRegistry()
    adapterRegistry.register(createGenreAdapter(sourceRegistry.withCapability('genreArtists')))
    adapterRegistry.register(
      createSimilarAdapter(sourceRegistry.withCapability('similarArtists'), {
        searchArtist: createMusicBrainzClient().searchArtist,
      }),
    )

    // Last.fm adapters -- only if the user has a Last.fm API key
    if (lfApiKey) {
      adapterRegistry.register(createLastfmTagAdapter({ apiKey: lfApiKey }))
      adapterRegistry.register(createLastfmChartsAdapter({ apiKey: lfApiKey }))
    }

    // ListenBrainz adapter -- only if the user has LB credentials
    if (lbUsername && lbToken) {
      adapterRegistry.register(createListenBrainzAdapter({ username: lbUsername, token: lbToken }))
    }

    // Spotify adapters -- only if the user has a stored OAuth token
    if (userId !== null && userId !== undefined) {
      const spotifyOAuthRow = await getOAuthToken(db, userId, 'spotify')
      if (spotifyOAuthRow) {
        const getToken = () => resolveSpotifyToken(db, userId)
        adapterRegistry.register(createSpotifyPlaylistAdapter({ getToken }))
        adapterRegistry.register(createSpotifyChartsAdapter({ getToken }))
      }
    }

    setCachedAdapterRegistry(userId ?? null, adapterRegistry)
  }

  const adapter = adapterRegistry.get(sub.sourceType)
  if (!adapter) {
    console.warn(
      `[subscription-runner] Unknown type '${sub.sourceType}' for subscription ${subscriptionId} -- skipping`,
    )
    return
  }

  const subscriptionConfig: SubscriptionConfig = {
    id: sub.id,
    userId: sub.userId,
    sourceType: sub.sourceType,
    sourceConfig: sub.sourceConfig,
    maxArtistsPerRun: sub.maxArtistsPerRun,
    scoreThreshold: sub.scoreThreshold,
    scoringWeightPreset: sub.scoringWeightPreset,
    scoringWeightOverrides: sub.scoringWeightOverrides,
  }

  await runSubscription(subscriptionConfig, adapter, {
    db: storeDb,
    queries: {
      insertRun: (data) => insertRun(db, data),
      completeRun: (id, data) => completeRun(db, id, data),
      updateSubscription: (id, data) => updateSubscription(db, id, data),
    },
    mbClient: createMusicBrainzClient() as SubMBClient,
    lidarr: lidarrClient ?? undefined,
    userId: sub.userId ?? undefined,
    // Populate library MBIDs from Lidarr so subscriptions don't recommend
    // artists already in the library (same dedup the main pipeline does)
    libraryMbids: lidarrClient
      ? new Set((await lidarrClient.getArtists()).map((a) => a.foreignArtistId))
      : new Set<string>(),
    libraryGenres: [],
    rejectedMbids,
    feedbackHistory,
    cooldownDays: prefs.rejectionCooldownDays,
    defaultScoreThreshold: prefs.scoreThreshold,
  })
}

// Run generation for all playlists that are due (called by the playlist scheduler)
async function runAllPlaylists(): Promise<void> {
  const due = await getPlaylistsDueForGeneration(db)
  if (due.length === 0) return
  console.log(`[playlist-scheduler] ${due.length} playlist(s) due for generation`)

  for (const playlist of due) {
    try {
      const strategyDeps = buildStrategyDeps(db, playlist.userId ?? null)
      const cfg = playlist.config ?? { size: 25, trackSourcePriority: ['spotify' as const] }
      const result = await generatePlaylist(
        playlist.strategy as import('./db/schema').PlaylistStrategy,
        {
          size: cfg.size,
          genre: cfg.genre,
          mood: cfg.mood,
          trackSourcePriority: cfg.trackSourcePriority,
        },
        strategyDeps,
        {},
      )

      const trackInserts = result.tracks.map((t, i) => ({
        playlistId: playlist.id,
        artistName: t.artistName,
        trackName: t.trackName ?? null,
        mbid: t.mbid ?? null,
        spotifyUri: t.spotifyUri ?? null,
        deezerId: t.deezerId ?? null,
        localPath: t.localPath ?? null,
        position: i,
      }))

      await replacePlaylistTracks(db, playlist.id, trackInserts)
      await updatePlaylistRow(db, playlist.id, {
        lastGeneratedAt: new Date(),
        trackCount: result.tracks.length,
      })

      console.log(
        `[playlist-scheduler] Playlist '${playlist.name}' (id=${playlist.id}): ${result.tracks.length} tracks`,
      )
    } catch (err: unknown) {
      console.error(
        `[playlist-scheduler] Failed to generate playlist '${playlist.name}' (id=${playlist.id}):`,
        err,
      )
    }
  }
}

// Lazy OIDC service getter -- reads current settings from DB on each call,
// reconstructs the service only when the config (issuer/client/secret/scopes) changes.
// This ensures settings-UI changes to OIDC config take effect without a restart.
let oidcServiceCache: { service: OidcService; configKey: string } | null = null

async function getOidcService(): Promise<OidcService | null> {
  const settings = await getSettings(db)

  // DB settings take precedence; env vars are fallback
  const issuerUrl = (settings?.oidcIssuerUrl as string | undefined) ?? envConfig.oidcIssuerUrl ?? ''
  const clientId = (settings?.oidcClientId as string | undefined) ?? envConfig.oidcClientId ?? ''
  const clientSecret =
    (settings?.oidcClientSecret as string | undefined) ?? envConfig.oidcClientSecret ?? ''
  const scopes =
    (settings?.oidcScopes as string | undefined) ?? envConfig.oidcScopes ?? 'openid profile email'

  if (!issuerUrl || !clientId) return null

  const configKey = `${issuerUrl}|${clientId}|${clientSecret}|${scopes}`
  if (oidcServiceCache?.configKey === configKey) {
    return oidcServiceCache.service
  }

  const service = new OidcService({ issuerUrl, clientId, clientSecret, scopes })
  oidcServiceCache = { service, configKey }
  return service
}

// Static search sources -- no auth required, safe to build once at startup.
function buildStaticSearchSources(): SearchSource[] {
  return [
    createMusicBrainzSearchSource(createMusicBrainzClient()),
    createDeezerSearchSource(createDeezerClient()),
    createBandcampSearchSource(createBandcampClient()),
  ]
}

const staticSearchSources = buildStaticSearchSources()

const app = createApp({
  db,
  storeDb,
  orchestrator,
  scheduler,
  providerRegistry,
  isSetupComplete: () => isSetupComplete(db),
  getSettings: () => getSettings(db),
  updateSettings: (partial) => updateSettings(db, partial),
  completeSetup: (config) => completeSetup(db, config),
  getLastBatch: async () => {
    const batches = await listBatches(db)
    return batches[0] ?? null
  },
  listRecommendations: (filters) => listRecommendations(db, filters),
  getRecommendation: (id) => getRecommendation(db, id),
  updateRecommendationStatus: (id, status, extra) =>
    updateRecommendationStatus(db, id, status, extra),
  bulkUpdateStatus: (ids, status) => bulkUpdateStatus(db, ids, status),
  filterOwnedIds: (ids, userId) => filterOwnedIds(db, ids, userId),
  listBatches: () => listBatches(db),
  getBatch: (id) => getBatch(db, id),
  getArtistById: (id) => getArtistById(db, id),
  restartScheduler: (cron: string | null) => {
    if (!cron) {
      scheduler.remove('main-pipeline')
      console.log('Scheduler stopped')
      return
    }
    scheduler.schedule('main-pipeline', cron, runPipeline)
    console.log(`Scheduler restarted with cron: ${cron}`)
  },
  createUser: (data) => createUser(db, data),
  getUserByUsername: (username) => getUserByUsername(db, username),
  getUserById: (id) => getUserById(db, id),
  getUserCount: () => getUserCount(db),
  updatePassword: (id, hash) => updatePassword(db, id, hash),
  getOidcService,
  getUserByOidcSubject: (subject) => getUserByOidcSubject(db, subject),
  getUserByEmail: (email) => getUserByEmail(db, email),
  updateUser: (id, data) => updateUser(db, id, data),
  listUsers: () => listUsers(db),
  deleteUser: (id) => deleteUser(db, id),
  genreService,
  libraryHealth,
  skyhookWarmer,
  subscriptionQueries: subscriptionQueriesImpl,
  runSubscription: (id) => executeSubscription(id),
  targetQueries: {
    createTarget: (data: TargetInsert) => createTarget(db, data),
    getTargetsByUser: (userId: number) => getTargetsByUser(db, userId),
    getAllTargets: () => getAllTargets(db),
    getTarget: (id: number) => getTarget(db, id),
    updateTarget: (id: number, data: Parameters<typeof updateTarget>[2]) =>
      updateTarget(db, id, data),
    deleteTarget: (id: number) => deleteTarget(db, id),
  },
  testTargetConnection: async (type, config) => {
    if (type === 'lidarr') {
      const target = createLidarrTarget(0, {
        url: config.url as string,
        apiKey: config.apiKey as string,
        skipTlsVerify: (config.skipTlsVerify as boolean) ?? false,
      })
      return target.testConnection()
    }

    if (type === 'jellyfin') {
      const client = createJellyfinClient(
        config.url as string,
        config.apiKey as string,
        (config.userId as string) ?? '',
        { skipTlsVerify: (config.skipTlsVerify as boolean) ?? false },
      )
      return client.testConnection()
    }

    if (type === 'spotify-playlist') {
      // Spotify test requires OAuth -- can't test from config alone
      return {
        success: false,
        message:
          'Spotify targets require OAuth connection. Use Settings > Connections to connect Spotify first.',
      }
    }

    return { success: false, message: `Unknown target type: ${type}` }
  },
  getFeedbackHistory: () => getGenreFeedbackHistory(db),
  dashboardQueries: {
    getTopGenresForUser: (userId) => getTopGenresForUser(db, userId),
    getRecentActivity: (userId, isAdmin, limit) => getRecentActivity(db, userId, isAdmin, limit),
  },
  getEnabledTargetsForUser: async (userId) => {
    const rows = await getTargetsByUser(db, userId)
    const settings = await getSettings(db)
    const prefs = (settings?.preferences ?? {}) as Record<string, unknown>

    const targets: import('./core/targets/types').DestinationTarget[] = []
    for (const row of rows) {
      if (!row.enabled) continue
      if (row.type === 'lidarr') {
        targets.push(
          createLidarrTarget(row.id, {
            url: row.config.url as string,
            apiKey: row.config.apiKey as string,
            skipTlsVerify: (row.config.skipTlsVerify as boolean) ?? false,
            qualityProfileId: Number(prefs.qualityProfileId ?? 1),
            metadataProfileId: Number(prefs.metadataProfileId ?? 1),
            rootFolderId: Number(prefs.rootFolderId ?? 1),
          }),
        )
      }

      if (row.type === 'spotify-playlist') {
        targets.push(
          createSpotifyPlaylistTarget(row.id, {
            getAccessToken: () => resolveSpotifyToken(db, userId),
          }),
        )
      }
    }
    return targets
  },
  playlistDeps: {
    db,
    playlistScheduler,
    getTargetsByUser: (userId) => getTargetsByUser(db, userId),
    buildPlaylistTarget: (row) => {
      if (row.type === 'navidrome-playlist') {
        return createNavidromePlaylistTarget(row.id, {
          url: row.config.url as string,
          username: row.config.username as string,
          password: row.config.password as string,
        })
      }
      if (row.type === 'jellyfin-playlist') {
        return createJellyfinPlaylistTarget(row.id, {
          url: row.config.url as string,
          apiKey: row.config.apiKey as string,
          userId: row.config.userId as string,
        })
      }
      if (row.type === 'plex-playlist') {
        return createPlexPlaylistTarget(row.id, {
          url: row.config.url as string,
          token: row.config.token as string,
        })
      }
      return null
    },
  },
  search: {
    listSources: async (userId) => {
      const spotifyOAuth = userId ? await getOAuthToken(db, userId, 'spotify') : null
      return buildSearchSourceCatalog({
        hasSpotifyOAuth: Boolean(spotifyOAuth),
        hasTidalSearch: false,
      })
    },
    search: async (query, opts) => {
      const sources: SearchSource[] = [...staticSearchSources]

      // Add Spotify if the authenticated user has a stored OAuth token.
      // Capture userId in a local const so TypeScript's control-flow narrowing
      // carries into the async getToken callback (opts.userId could be re-read as
      // undefined inside the callback if we referenced opts directly).
      const searchUserId = opts?.userId
      if (searchUserId) {
        const spotifyOAuth = await getOAuthToken(db, searchUserId, 'spotify')
        if (spotifyOAuth) {
          sources.push(
            createSpotifySearchSource({
              getToken: () => resolveSpotifyToken(db, searchUserId),
            }),
          )
        }
      }
      // TIDAL search requires client credentials (not per-user OAuth). Wire it here
      // once TIDAL client ID/secret are exposed via settings (not yet implemented).

      const filtered = opts?.sources ? sources.filter((s) => opts.sources?.includes(s.id)) : sources
      return multiSourceSearch(query, filtered, { limit: opts?.limit })
    },
  },
})

const port = envConfig.port
const server = serve({ fetch: app.fetch, port })

// Auto-complete setup from env vars, then bootstrap user, then start scheduler
;(async () => {
  try {
    const done = await isSetupComplete(db)
    if (!done && canAutoSetup()) {
      const config: SetupConfig = {
        lidarrUrl: envConfig.lidarrUrl ?? '',
        lidarrApiKey: envConfig.lidarrApiKey ?? '',
        skipTlsVerify: envConfig.skipTlsVerify,
        listenbrainzUsername: envConfig.listenbrainzUsername,
        listenbrainzToken: envConfig.listenbrainzToken,
        lastfmUsername: envConfig.lastfmUsername,
        lastfmApiKey: envConfig.lastfmApiKey,
        aiProvider: envConfig.aiProvider,
        aiApiKey: envConfig.aiApiKey,
        aiModel: envConfig.aiModel,
        aiBaseUrl: envConfig.aiBaseUrl,
      }
      if (envConfig.webhookUrl) {
        config.preferences = { ...DEFAULT_PREFERENCES, webhookUrl: envConfig.webhookUrl }
      }
      await completeSetup(db, config)
      console.log('Setup auto-completed from environment variables')
    }

    // Bootstrap initial admin user from env vars if no users exist
    const { initialUsername, initialPassword } = envConfig
    if (initialUsername && initialPassword) {
      if (initialPassword.length < 8) {
        console.error(
          'DIGARR_INITIAL_PASSWORD must be at least 8 characters -- skipping user creation',
        )
      } else {
        const count = await getUserCount(db)
        if (count === 0) {
          const passwordHash = hashPassword(initialPassword)
          await createUser(db, { username: initialUsername, passwordHash, isAdmin: true })
          console.log(`Initial admin user "${initialUsername}" created from environment variables`)
        }
      }
    }

    // Backfill: create Lidarr target for existing installations
    const settings = await getSettings(db)
    if (settings?.lidarrUrl && settings?.lidarrApiKey) {
      const existingTargets = await getTargetsByType(db, 'lidarr')
      if (existingTargets.length === 0) {
        const allUsers = await listUsers(db)
        const admin = allUsers.find((u) => u.isAdmin) ?? allUsers[0]
        if (admin) {
          await createTarget(db, {
            type: 'lidarr',
            name: 'Lidarr',
            config: {
              url: settings.lidarrUrl as string,
              apiKey: settings.lidarrApiKey as string,
              skipTlsVerify: (settings.skipTlsVerify as boolean) ?? false,
            },
            userId: admin.id,
          })
          console.log('[boot] Created Lidarr target from existing settings (migration backfill)')
        }
      }
    }

    // Start schedulers -- single getSettings() call shared across all
    const prefs = mergePreferences(settings?.preferences)
    const cron = prefs.scheduleCron
    if (cron) {
      scheduler.schedule('main-pipeline', cron, runPipeline)
      console.log(`Scheduler started with cron: ${cron}`)
    }

    const subs = await getEnabledSubscriptions(db)
    for (const sub of subs) {
      scheduler.schedule(`subscription-${sub.id}`, sub.cron, () => executeSubscription(sub.id))
      console.log(`Subscription '${sub.name}' (id=${sub.id}) scheduled with cron: ${sub.cron}`)
    }

    if (prefs.playlistSchedule && prefs.playlistEnabled) {
      playlistScheduler.start(prefs.playlistSchedule, runAllPlaylists)
    }
  } catch (err: unknown) {
    console.error('Failed to initialize:', err)
  }
})()

// Clean up expired sessions every 6 hours
setInterval(
  async () => {
    try {
      await sessionQueries(db).deleteExpired()
    } catch {
      /* best-effort cleanup */
    }
  },
  6 * 60 * 60 * 1000,
)

console.log(`Digarr running on http://localhost:${port}`)
if (!envConfig.allowedOrigin && process.env.NODE_ENV === 'production') {
  console.warn(
    'ALLOWED_ORIGIN not set -- CORS rejects all cross-origin requests. Set ALLOWED_ORIGIN to your domain.',
  )
}
if (envConfig.authToken && envConfig.authToken.length < 16) {
  console.warn(
    'DIGARR_AUTH_TOKEN is shorter than 16 characters -- this is trivially brute-forceable. Use a longer token.',
  )
}
if (envConfig.authToken) {
  console.warn(
    'DEPRECATED: DIGARR_AUTH_TOKEN provides read-only access with no admin privileges, no per-user features, and no audit trail. Create a user account instead.',
  )
}
if (!envConfig.authToken && !envConfig.initialUsername) {
  console.warn(
    'No DIGARR_AUTH_TOKEN or DIGARR_INITIAL_USERNAME set -- the API is unauthenticated until the first user registers. Set one for production security.',
  )
}

// Graceful shutdown
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    console.log(`${signal} received, shutting down...`)
    scheduler.stopAll()
    playlistScheduler.stop()
    server.close()
    await new Promise((resolve) => setTimeout(resolve, 5000))
    await pool.end()
    process.exit(0)
  })
}
