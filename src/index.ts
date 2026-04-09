import { serve } from '@hono/node-server'
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { canAutoSetup, envConfig } from './config/env'
import { hashPassword } from './core/auth'
import { OidcService } from './core/auth/oidc'
import { createBandcampClient } from './core/clients/bandcamp'
import { createDeezerClient } from './core/clients/deezer'
import { createEmbyClient } from './core/clients/emby'
import { createJellyfinClient } from './core/clients/jellyfin'
import { createLidarrClient } from './core/clients/lidarr'
import { createMusicBrainzClient } from './core/clients/musicbrainz'
import { createPlexClient } from './core/clients/plex'
import { createSpotifyClient } from './core/clients/spotify'
import { initEncryption, isEncryptionEnabled } from './core/crypto'
import { GenreService } from './core/genre/service'
import { createJobRecorder } from './core/jobs/recorder'
import { startStuckDetector } from './core/jobs/stuck-detector'
import { createAlbumCoverageService } from './core/library/album-coverage'
import { LibraryHealthService } from './core/library/health'
import { startLibrarySyncScheduler } from './core/library/scheduler'
import { SkyHookWarmer } from './core/library/skyhook-warmer'
import { createEmbyLibrarySource } from './core/library/sources/emby'
import { createJellyfinLibrarySource } from './core/library/sources/jellyfin'
import { createLidarrLibrarySource } from './core/library/sources/lidarr'
import { createPlexLibrarySource } from './core/library/sources/plex'
import { createLibrarySyncStore } from './core/library/store'
import { createSyncOrchestrator, type SyncOrchestrator } from './core/library/sync'
import { migrateLegacyListeningConnections } from './core/ops/legacy-listening-connections'
import { runPreFlightCheck } from './core/ops/upgrade'
import { analyze } from './core/pipeline/analyze'
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
import { enrichSearchResultsWithImages } from './core/search/enrich'
import type { SearchSource } from './core/search/multi-source'
import { multiSourceSearch } from './core/search/multi-source'
import { createBandcampSearchSource } from './core/search/sources/bandcamp'
import { createDeezerSearchSource } from './core/search/sources/deezer'
import { createMusicBrainzSearchSource } from './core/search/sources/musicbrainz'
import { createSpotifySearchSource } from './core/search/sources/spotify'
import { setSessionStore } from './core/sessions'
import { resolveSpotifyToken } from './core/spotify-auth'
import { createCsvImportAdapter } from './core/subscriptions/adapters/csv-import'
import { createGenreAdapter } from './core/subscriptions/adapters/genre'
import { createLastfmChartsAdapter } from './core/subscriptions/adapters/lastfm-charts'
import { createLastfmTagAdapter } from './core/subscriptions/adapters/lastfm-tag'
import { createListenBrainzAdapter } from './core/subscriptions/adapters/listenbrainz'
import { createSimilarAdapter } from './core/subscriptions/adapters/similar'
import { createSpotifyChartsAdapter } from './core/subscriptions/adapters/spotify-charts'
import { createSpotifyLikedSongsAdapter } from './core/subscriptions/adapters/spotify-liked-songs'
import { createSpotifyPlaylistAdapter } from './core/subscriptions/adapters/spotify-playlist'
import { resolveSubscriptionSourceConnections } from './core/subscriptions/connections'
import { AdapterRegistry } from './core/subscriptions/registry'
import { runSubscription } from './core/subscriptions/runner'
import type {
  MusicBrainzClient as SubMBClient,
  SubscriptionConfig,
} from './core/subscriptions/types'
import { createEmbyPlaylistTarget } from './core/targets/emby-playlist'
import { createJellyfinPlaylistTarget } from './core/targets/jellyfin-playlist'
import { createLidarrTarget } from './core/targets/lidarr'
import { createNavidromePlaylistTarget } from './core/targets/navidrome-playlist'
import { createPlexPlaylistTarget } from './core/targets/plex-playlist'
import { createSpotifyPlaylistTarget } from './core/targets/spotify-playlist'
import { errMsg } from './core/validation'
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
import * as jobQueries from './db/queries/jobs'
import { getOAuthToken } from './db/queries/oauth-tokens'
import {
  getEnabledPlaylists,
  getPlaylistWithTracks,
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
  createSubscription,
  deleteSubscription,
  getEnabledSubscriptions,
  getSubscription,
  getSubscriptionsByUser,
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
  updateUserConnections,
} from './db/queries/users'
import {
  artists,
  DEFAULT_PREFERENCES,
  libraryArtists,
  mergePreferences,
  recommendationBatches,
  recommendations,
} from './db/schema'
import { createApp } from './server'

// Job recording -- initialized after DB setup, before createApp()
let jobRecorder: import('./core/jobs/types').JobRecorder

// Initialize encryption before any DB operations.
initEncryption(envConfig.encryptionKey)
if (isEncryptionEnabled()) {
  console.log('Field-level encryption enabled')
} else if (process.env.NODE_ENV === 'production') {
  console.warn(
    'WARNING: DIGARR_ENCRYPTION_KEY is not set -- API keys and tokens are stored as plaintext in the database. Set this variable for production security.',
  )
} else {
  console.log('Field-level encryption disabled (set DIGARR_ENCRYPTION_KEY to enable)')
}

// Pre-flight check: detect pending migrations and auto-backup if needed.
await runPreFlightCheck(db)

// Run pending database migrations before anything else.
// Uses drizzle-orm's programmatic migrator -- safe to run every boot (idempotent).
await migrate(db, { migrationsFolder: './drizzle' })
console.log('Database migrations applied')

// Wire up DB-backed session store after migrations are applied.
setSessionStore(sessionQueries(db))

// Read library sync interval once; used by both the orchestrator's stale
// check and the background scheduler. Runtime changes require a restart.
const bootSettings = await getSettings(db)
const librarySyncIntervalHours = bootSettings?.librarySyncIntervalHours ?? 6

const librarySyncStore = createLibrarySyncStore(db)

const storeDb: StoreDb = {
  getExistingRecommendationMbids: async (userId) => {
    const base = db
      .select({ mbid: artists.mbid })
      .from(recommendations)
      .innerJoin(artists, eq(recommendations.artistId, artists.id))
    const rows =
      userId !== undefined
        ? await base.where(or(eq(recommendations.userId, userId), isNull(recommendations.userId)))
        : await base
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
  getLibraryArtistsForUser: async (userId, options) => {
    const conds = [or(eq(libraryArtists.userId, userId), isNull(libraryArtists.userId))]
    if (options?.onlyReconciled) conds.push(isNotNull(libraryArtists.mbid))
    if (options?.source) conds.push(eq(libraryArtists.source, options.source))
    return db
      .select({
        mbid: libraryArtists.mbid,
        name: libraryArtists.name,
        source: libraryArtists.source,
        sourceArtistId: libraryArtists.sourceArtistId,
        genres: libraryArtists.genres,
        matchMethod: libraryArtists.matchMethod,
        matchConfidence: libraryArtists.matchConfidence,
      })
      .from(libraryArtists)
      .where(and(...conds.filter((c): c is NonNullable<typeof c> => c !== undefined)))
  },
  userHasAnySyncState: (userId) => librarySyncStore.userHasAnySyncState(userId),
}

jobRecorder = createJobRecorder(db)
// Mark stuck jobs at startup
jobRecorder.markStuck().catch((err) => console.error('[startup] Stuck detection failed:', err))
// Reset any library_sync_state rows left in 'running' from a previous crash/restart.
// The orchestrator never finishes those, so the UI would show a permanent "running" badge.
librarySyncStore
  .clearRunningSyncStates()
  .then((n) => {
    if (n > 0) console.warn(`[startup] Cleared ${n} stale 'running' library sync state(s)`)
  })
  .catch((err) => console.error('[startup] Library sync state sweep failed:', err))

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

function extractSearchImageUrl(
  results: Array<{ images?: Array<{ coverType: string; remoteUrl?: string }> }>,
): string | undefined {
  const artist = results[0]
  if (!artist?.images?.length) return undefined

  for (const type of ['poster', 'fanart', 'banner']) {
    const image = artist.images.find((entry) => entry.coverType === type && entry.remoteUrl)
    if (image?.remoteUrl) return image.remoteUrl
  }

  return artist.images.find((entry) => entry.coverType !== 'clearlogo' && entry.remoteUrl)
    ?.remoteUrl
}

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

// ---------------------------------------------------------------------------
// Library sync orchestrator + per-source factories
// ---------------------------------------------------------------------------

// Helper that builds per-user sources from user connection rows.
async function buildPerUserLibrarySources(userId: number) {
  const conns = await getUserConnections(db, userId)
  if (!conns) return []
  const sources = []
  if (conns.plexUrl && conns.plexToken) {
    sources.push(createPlexLibrarySource(createPlexClient(conns.plexUrl, conns.plexToken), userId))
  }
  if (conns.jellyfinUrl && conns.jellyfinApiKey && conns.jellyfinUserId) {
    sources.push(
      createJellyfinLibrarySource(
        createJellyfinClient(conns.jellyfinUrl, conns.jellyfinApiKey, conns.jellyfinUserId),
        userId,
      ),
    )
  }
  if (conns.embyUrl && conns.embyApiKey && conns.embyUserId) {
    sources.push(
      createEmbyLibrarySource(
        createEmbyClient(conns.embyUrl, conns.embyApiKey, conns.embyUserId),
        userId,
      ),
    )
  }
  return sources
}

async function buildGlobalLibrarySources() {
  const s = await getSettings(db)
  if (s?.lidarrUrl && s?.lidarrApiKey) {
    return [
      createLidarrLibrarySource(
        createLidarrClient(s.lidarrUrl, s.lidarrApiKey, s.skipTlsVerify ?? false),
      ),
    ]
  }
  return []
}

const librarySyncOrchestrator: SyncOrchestrator = createSyncOrchestrator({
  store: librarySyncStore,
  recorder: jobRecorder,
  mbClient: createMusicBrainzClient(),
  buildPerUserSources: buildPerUserLibrarySources,
  buildGlobalSources: buildGlobalLibrarySources,
  staleHours: librarySyncIntervalHours,
})

const albumCoverage = createAlbumCoverageService({
  store: librarySyncStore,
  mbClient: createMusicBrainzClient(),
})

const runPipeline = async (userId?: number) => {
  const currentSettings = await getSettings(db)
  if (!currentSettings) return
  // Default to admin user when not provided (cron-triggered runs)
  let resolvedUserId = userId
  if (resolvedUserId === undefined) {
    const allUsers = await listUsers(db)
    const admin = allUsers.find((u) => u.isAdmin) ?? allUsers[0]
    resolvedUserId = admin?.id
  }
  if (resolvedUserId === undefined) return
  await orchestrator.run({
    db: storeDb,
    settings: currentSettings,
    providerRegistry,
    librarySync: librarySyncOrchestrator,
    userId: resolvedUserId,
  })
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
    adapterRegistry.register(createCsvImportAdapter())

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
        adapterRegistry.register(createSpotifyLikedSongsAdapter({ getToken }))
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

  // Library data: prefer the new sync cache when available, fall back to direct Lidarr.
  const subscriptionUserId = sub.userId ?? undefined
  let libraryMbids: Set<string>
  let libraryGenres: string[]
  if (subscriptionUserId !== undefined && storeDb.getLibraryArtistsForUser) {
    await librarySyncOrchestrator.syncForUser(subscriptionUserId).catch((err: unknown) => {
      console.warn(
        `[subscription-runner] library sync failed for user ${subscriptionUserId}:`,
        errMsg(err),
      )
    })
    const cached = await storeDb.getLibraryArtistsForUser(subscriptionUserId, {
      onlyReconciled: true,
    })
    libraryMbids = new Set(cached.map((a) => a.mbid).filter((m): m is string => m !== null))
    libraryGenres = [...new Set(cached.flatMap((a) => a.genres ?? []))]
  } else {
    const libraryArtistsRaw = lidarrClient ? await lidarrClient.getArtists() : []
    libraryGenres = [...new Set(libraryArtistsRaw.flatMap((a) => a.genres ?? []))]
    libraryMbids = new Set(libraryArtistsRaw.map((a) => a.foreignArtistId))
  }

  // Build topArtistNames from listening sources so subscriptions exclude
  // artists the user already listens to (same exclusion as main pipeline)
  let topArtistNames: Set<string> | undefined
  const sources = sourceRegistry.all()
  if (sources.length > 0) {
    const profile = await analyze(sources)
    topArtistNames = new Set<string>()
    for (const artist of profile.topArtists) {
      topArtistNames.add(artist.name.toLowerCase())
      if (artist.mbid) libraryMbids.add(artist.mbid)
    }
  }

  await runSubscription(subscriptionConfig, adapter, {
    db: storeDb,
    queries: {
      updateSubscription: (id, data) => updateSubscription(db, id, data),
    },
    jobRecorder,
    mbClient: createMusicBrainzClient() as SubMBClient,
    lidarr: lidarrClient ?? undefined,
    userId: sub.userId ?? undefined,
    libraryMbids,
    libraryGenres,
    rejectedMbids,
    feedbackHistory,
    cooldownDays: prefs.rejectionCooldownDays,
    defaultScoreThreshold: prefs.scoreThreshold,
    topArtistNames,
  })
}

async function buildPlaylistResolverDeps(userId: number | null) {
  const mbClient = createMusicBrainzClient()
  const deezerClient = createDeezerClient()
  const resolverDeps: import('./core/playlists/types').TrackResolverDeps = {
    musicbrainzRecordings: (artistMbid) => mbClient.getRecordings(artistMbid),
    deezerSearch: (query, limit = 10) => deezerClient.searchTracks(query, limit),
  }

  if (userId != null) {
    const spotifyOAuthRow = await getOAuthToken(db, userId, 'spotify')
    if (spotifyOAuthRow) {
      resolverDeps.spotifySearch = async (query, limit = 10) => {
        const accessToken = await resolveSpotifyToken(db, userId)
        const client = createSpotifyClient(accessToken)
        return client.searchTracks(query, limit)
      }
    }
  }

  return resolverDeps
}

async function executePlaylistGeneration(playlistId: number): Promise<void> {
  let jobId: number | null = null

  const result = await getPlaylistWithTracks(db, playlistId)
  if (!result) {
    console.warn(`[playlist-scheduler] Playlist ${playlistId} not found -- skipping`)
    return
  }

  const playlist = result.playlist

  try {
    jobId = await jobRecorder.start({
      type: 'playlist',
      userId: playlist.userId ?? undefined,
      metadata: { playlistName: playlist.name, strategy: playlist.strategy },
    })

    const strategyDeps = buildStrategyDeps(db, playlist.userId ?? null)
    const resolverDeps = await buildPlaylistResolverDeps(playlist.userId ?? null)
    const cfg = playlist.config ?? { size: 25, trackSourcePriority: ['spotify' as const] }
    const generation = await generatePlaylist(
      playlist.strategy as import('./db/schema').PlaylistStrategy,
      {
        size: cfg.size,
        genre: cfg.genre,
        mood: cfg.mood,
        trackSourcePriority: cfg.trackSourcePriority,
      },
      strategyDeps,
      resolverDeps,
    )

    const trackInserts = generation.tracks.map((track, index) => ({
      playlistId: playlist.id,
      artistName: track.artistName,
      trackName: track.trackName ?? null,
      mbid: track.mbid ?? null,
      spotifyUri: track.spotifyUri ?? null,
      deezerId: track.deezerId ?? null,
      localPath: track.localPath ?? null,
      position: index,
    }))

    await replacePlaylistTracks(db, playlist.id, trackInserts)
    await updatePlaylistRow(db, playlist.id, {
      lastGeneratedAt: new Date(),
      trackCount: generation.tracks.length,
    })

    if (playlist.targetIds.length > 0 && playlist.userId != null) {
      const settings = await getSettings(db)
      const globalSkipTlsVerify = settings?.skipTlsVerify ?? false
      const targetRows = await getTargetsByUser(db, playlist.userId)
      const enabledTargetRows = targetRows.filter(
        (row) => row.enabled && playlist.targetIds.includes(row.id),
      )
      const playlistItems = generation.tracks.map((track) => ({
        artistName: track.artistName,
        artistMbid: '',
        trackName: track.trackName ?? undefined,
        trackMbid: track.mbid ?? undefined,
      }))

      for (const targetRow of enabledTargetRows) {
        let target:
          | ReturnType<typeof createNavidromePlaylistTarget>
          | ReturnType<typeof createJellyfinPlaylistTarget>
          | ReturnType<typeof createEmbyPlaylistTarget>
          | ReturnType<typeof createPlexPlaylistTarget>
          | null = null

        if (targetRow.type === 'navidrome-playlist') {
          target = createNavidromePlaylistTarget(targetRow.id, {
            url: targetRow.config.url as string,
            username: targetRow.config.username as string,
            password: targetRow.config.password as string,
          })
        } else if (targetRow.type === 'jellyfin-playlist') {
          target = createJellyfinPlaylistTarget(targetRow.id, {
            url: targetRow.config.url as string,
            apiKey: targetRow.config.apiKey as string,
            userId: targetRow.config.userId as string,
            skipTlsVerify:
              (targetRow.config.skipTlsVerify as boolean | undefined) ?? globalSkipTlsVerify,
          })
        } else if (targetRow.type === 'emby-playlist') {
          target = createEmbyPlaylistTarget(targetRow.id, {
            url: targetRow.config.url as string,
            apiKey: targetRow.config.apiKey as string,
            userId: targetRow.config.userId as string,
            skipTlsVerify:
              (targetRow.config.skipTlsVerify as boolean | undefined) ?? globalSkipTlsVerify,
          })
        } else if (targetRow.type === 'plex-playlist') {
          target = createPlexPlaylistTarget(targetRow.id, {
            url: targetRow.config.url as string,
            token: targetRow.config.token as string,
          })
        }

        if (!target?.createPlaylist) continue

        try {
          await target.createPlaylist(playlist.name, playlistItems)
        } catch (err: unknown) {
          console.error(
            `[playlists] Failed to push to target ${targetRow.type}(${targetRow.id}):`,
            err,
          )
        }
      }
    }

    console.log(
      `[playlist-scheduler] Playlist '${playlist.name}' (id=${playlist.id}): ${generation.tracks.length} tracks`,
    )

    if (jobId != null) {
      await jobRecorder.complete(jobId, {
        metadata: {
          playlistName: playlist.name,
          trackCount: generation.tracks.length,
          strategy: playlist.strategy,
        },
      })
    }
  } catch (err: unknown) {
    if (jobId != null) {
      await jobRecorder.fail(jobId, errMsg(err)).catch(() => {})
    }
    throw err
  }
}

async function restartPlaylistScheduler(): Promise<void> {
  playlistScheduler.stopAll()

  const settings = await getSettings(db)
  const prefs = mergePreferences(settings?.preferences)
  if (!prefs.playlistEnabled) return

  const playlists = await getEnabledPlaylists(db)
  for (const playlist of playlists) {
    if (!playlist.schedule) continue

    playlistScheduler.schedule(`playlist-${playlist.id}`, playlist.schedule, async () => {
      await executePlaylistGeneration(playlist.id)
    })
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
  restartPlaylistScheduler,
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
  librarySync: librarySyncOrchestrator,
  librarySyncStore,
  albumCoverage,
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

    if (type === 'emby-playlist') {
      const target = createEmbyPlaylistTarget(0, {
        url: config.url as string,
        apiKey: config.apiKey as string,
        userId: config.userId as string,
        skipTlsVerify: (config.skipTlsVerify as boolean) ?? false,
      })
      return target.testConnection()
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
  jobRecorder,
  jobQueries: {
    listJobs: (filters) => jobQueries.listJobs(db, filters),
    getJobById: (id) => jobQueries.getJobById(db, id),
    getJobHealth: (nextRun) => jobQueries.getJobHealth(db, nextRun),
    getJobsForSubscription: (subId, limit) => jobQueries.getJobsForSubscription(db, subId, limit),
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
    runPlaylistGeneration: (playlistId) => executePlaylistGeneration(playlistId),
    restartPlaylistScheduler,
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
      const merged = await multiSourceSearch(query, filtered, { limit: opts?.limit })

      return enrichSearchResultsWithImages(merged, {
        getCachedImages: async (mbids) => {
          if (mbids.length === 0) return new Map<string, string>()

          const rows = await db
            .select({ mbid: artists.mbid, imageUrl: artists.imageUrl })
            .from(artists)
            .where(inArray(artists.mbid, mbids))

          return new Map(
            rows
              .filter((row): row is { mbid: string; imageUrl: string } => Boolean(row.imageUrl))
              .map((row) => [row.mbid, row.imageUrl]),
          )
        },
        lookupLidarrImage: async (mbid) => {
          const results = (await lazyLidarrClient.lookupArtist(`lidarr:${mbid}`)) as Array<{
            images?: Array<{ coverType: string; remoteUrl?: string }>
          }>
          return extractSearchImageUrl(results)
        },
        cacheImage: async (mbid, url) => {
          await db
            .update(artists)
            .set({ imageUrl: url, imageFailedAt: null })
            .where(eq(artists.mbid, mbid))
        },
      })
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

    const settingsBeforeMigration = await getSettings(db)
    await migrateLegacyListeningConnections({
      settings: settingsBeforeMigration,
      envLegacy: {
        listenbrainzUsername: envConfig.listenbrainzUsername,
        listenbrainzToken: envConfig.listenbrainzToken,
        lastfmUsername: envConfig.lastfmUsername,
        lastfmApiKey: envConfig.lastfmApiKey,
      },
      users: await listUsers(db),
      getUserConnections: (userId) => getUserConnections(db, userId),
      updateUserConnections: (userId, data) => updateUserConnections(db, userId, data),
      updateSettings: (partial) => updateSettings(db, partial),
    })

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

    await restartPlaylistScheduler()

    // Library sync scheduler -- background, idempotent. Boot fire is non-blocking.
    startLibrarySyncScheduler({
      intervalHours: librarySyncIntervalHours,
      orchestrator: librarySyncOrchestrator,
      listUserIds: async () => (await listUsers(db)).map((u) => u.id),
    })
    // Fire one sync at boot so fresh installs don't wait for the first cron tick
    void librarySyncOrchestrator
      .syncGlobal()
      .catch((err) => console.error('[boot] initial library syncGlobal failed:', err))

    // Start stuck job detector
    startStuckDetector(jobRecorder)
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

// Graceful shutdown -- wait for in-flight pipeline runs before exiting
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    console.log(`${signal} received, shutting down...`)
    scheduler.stopAll()
    playlistScheduler.stopAll()
    server.close()
    // Hard deadline: exit no matter what after 30s
    const deadline = setTimeout(() => {
      console.warn('Shutdown deadline exceeded, forcing exit')
      process.exit(1)
    }, 30_000)
    deadline.unref()
    // Wait for pipeline to finish if running (up to 25s)
    if (orchestrator.isRunning) {
      console.log('Waiting for pipeline to finish...')
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!orchestrator.isRunning) {
            clearInterval(check)
            resolve()
          }
        }, 500)
        setTimeout(() => {
          clearInterval(check)
          resolve()
        }, 25_000)
      })
    }
    await pool.end()
    clearTimeout(deadline)
    process.exit(0)
  })
}
