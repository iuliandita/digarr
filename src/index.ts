import { serve } from '@hono/node-server'
import { Cron } from 'croner'
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { canAutoSetup, envConfig } from './config/env'
import { requiresApprovalRequest } from './core/approvals/policy'
import { OidcService } from './core/auth/oidc'
import { createBandcampClient } from './core/clients/bandcamp'
import { createDeezerClient } from './core/clients/deezer'
import { createEmbyClient } from './core/clients/emby'
import { createJellyfinClient } from './core/clients/jellyfin'
import { createLidarrClient } from './core/clients/lidarr'
import { createMusicBrainzClient } from './core/clients/musicbrainz'
import { createPlexClient } from './core/clients/plex'
import { tryConsume } from './core/clients/rate-limiter'
import { createSlskdClient } from './core/clients/slskd'
import { createSubsonicClient } from './core/clients/subsonic'
import { createTidalClient } from './core/clients/tidal'
import { decryptChannelSecrets, initEncryption, isEncryptionEnabled } from './core/crypto'
import { createDefaultDiscoveryModeRegistry } from './core/discovery-modes/registry'
import { runDiscoveryMode } from './core/discovery-modes/run'
import { GenreService } from './core/genre/service'
import { resolveSupportedLocale } from './core/i18n/locales'
import { startDigestNotifier } from './core/jobs/digest-notifier'
import { recordFailureSafely } from './core/jobs/record-failure-safely'
import { createJobRecorder, markInterruptedJobs } from './core/jobs/recorder'
import { startStuckDetector } from './core/jobs/stuck-detector'
import { createAlbumCoverageService } from './core/library/album-coverage'
import { LibraryHealthService } from './core/library/health'
import { startLibraryHealthScheduler } from './core/library/health-scheduler'
import { startLibrarySyncScheduler } from './core/library/scheduler'
import { SkyHookWarmer } from './core/library/skyhook-warmer'
import { createEmbyLibrarySource } from './core/library/sources/emby'
import { createJellyfinLibrarySource } from './core/library/sources/jellyfin'
import { createLidarrLibrarySource } from './core/library/sources/lidarr'
import { createPlexLibrarySource } from './core/library/sources/plex'
import { createSubsonicLibrarySource } from './core/library/sources/subsonic'
import { createLibrarySyncStore } from './core/library/store'
import { createSyncOrchestrator, type SyncOrchestrator } from './core/library/sync'
import { markShuttingDown } from './core/lifecycle'
import { dispatch } from './core/notifications'
import { encryptLegacyPlaintext } from './core/ops/encrypt-legacy'
import { bootstrapInitialAdmin } from './core/ops/initial-admin'
import { migrateLegacyListeningConnections } from './core/ops/legacy-listening-connections'
import { isMaintenance, setMaintenance } from './core/ops/maintenance'
import { runPreFlightCheck } from './core/ops/upgrade'
import { analyze } from './core/pipeline/analyze'
import { waitForGenreWarmers } from './core/pipeline/genre-backfill'
import { PipelineOrchestrator } from './core/pipeline/orchestrator'
import { type StoreDb, saveRecommendationChunk } from './core/pipeline/store'
import { SubscriptionScheduler } from './core/pipeline/subscription-scheduler'
import { createSavedPlaylistExportStore, pushSavedPlaylistToTargets } from './core/playlists/export'
import { withPlaylistLock } from './core/playlists/generation-lock'
import { generatePlaylist, playlistGenerationFailure } from './core/playlists/generator'
import { buildPlaylistResolverDeps } from './core/playlists/resolver-deps'
import { PlaylistScheduler, schedulePlaylists } from './core/playlists/scheduler'
import { buildStrategyDeps } from './core/playlists/strategy-deps'
import { getAudioMuseConfig } from './core/plugins/audiomuse'
import { createDiscogsSource } from './core/plugins/discogs'
import { createLastFmSource } from './core/plugins/lastfm'
import { createListenBrainzSource } from './core/plugins/listenbrainz'
import { SourceRegistry } from './core/plugins/registry'
import { isConnectedToken, resolveProviderToken } from './core/provider-auth'
import { createDefaultRegistry } from './core/providers/registry'
import {
  createScrobblerWriteBack,
  type PlaylistGenerationTrigger,
} from './core/scrobbler-write-back'
import { buildSearchSourceCatalog } from './core/search/catalog'
import { enrichSearchResultsWithImages } from './core/search/enrich'
import type { SearchSource } from './core/search/multi-source'
import { multiSourceSearch } from './core/search/multi-source'
import { createBandcampSearchSource } from './core/search/sources/bandcamp'
import { createDeezerSearchSource } from './core/search/sources/deezer'
import { createMusicBrainzSearchSource } from './core/search/sources/musicbrainz'
import { createSpotifySearchSource } from './core/search/sources/spotify'
import { createTidalSearchSource } from './core/search/sources/tidal'
import { setSessionStore } from './core/sessions'
import { createSlskdOrchestrator } from './core/slskd/orchestrator'
import { createSlskdRunner } from './core/slskd/runner'
import { createCsvImportAdapter } from './core/subscriptions/adapters/csv-import'
import { createDeezerAdapter } from './core/subscriptions/adapters/deezer'
import { createGenreAdapter } from './core/subscriptions/adapters/genre'
import { createLastfmChartsAdapter } from './core/subscriptions/adapters/lastfm-charts'
import { createLastfmTagAdapter } from './core/subscriptions/adapters/lastfm-tag'
import { createListenBrainzAdapter } from './core/subscriptions/adapters/listenbrainz'
import { createSimilarAdapter } from './core/subscriptions/adapters/similar'
import { createSpotifyChartsAdapter } from './core/subscriptions/adapters/spotify-charts'
import { createSpotifyLikedSongsAdapter } from './core/subscriptions/adapters/spotify-liked-songs'
import { createSpotifyPlaylistAdapter } from './core/subscriptions/adapters/spotify-playlist'
import { resolveSubscriptionSourceConnections } from './core/subscriptions/connections'
import { AdapterRegistry, DISCOVERY_MODE_SUBSCRIPTION_TYPE } from './core/subscriptions/registry'
import { runSubscription } from './core/subscriptions/runner'
import type {
  MusicBrainzClient as SubMBClient,
  SubscriptionConfig,
} from './core/subscriptions/types'
import { createLidarrTarget } from './core/targets/lidarr'
import {
  linkLidarrTargetsToServerConnection,
  resolveLidarrTargetConnection,
  resolveLidarrTargetDefaults,
  withResolvedLidarrConnection,
} from './core/targets/lidarr-connection'
import { retryWaitingApprovals } from './core/targets/lidarr-retry-worker'
import { createSavedPlaylistExportTarget } from './core/targets/saved-playlist-targets'
import { createSlskdTarget } from './core/targets/slskd'
import { updateSlskdRecommendationAction } from './core/targets/slskd-recommendation'
import { createSpotifyPlaylistTarget } from './core/targets/spotify-playlist'
import { testTargetConnection } from './core/targets/test-connection'
import type { DestinationTarget } from './core/targets/types'
import { errMsg } from './core/validation'
import { closeDb, db, pool } from './db'
import { runMigrations } from './db/migrate'
import {
  getBlockedAlbumKeys,
  listAlbumBlocks as listAlbumBlocksQuery,
  removeAlbumBlock as removeAlbumBlockQuery,
} from './db/queries/album-blocks'
import {
  addBlock as addArtistBlockQuery,
  getBlockedMbids as getBlockedArtistMbids,
  listBlocks as listArtistBlocksQuery,
  removeBlock as removeArtistBlockQuery,
} from './db/queries/artist-blocks'
import { getPopularityMap, lookupByName } from './db/queries/artist-metadata'
import {
  getArtistById,
  getArtistGenreCacheByAliases,
  getArtistGenreCacheByMbids,
  upsertArtist,
  upsertArtistGenreAlias,
  upsertArtistGenres,
} from './db/queries/artists'
import { completeBatch, failBatch, getBatch, listBatches } from './db/queries/batches'
import {
  getLatestGenreCoverage,
  getRecentActivity,
  getTopGenresForUser,
} from './db/queries/dashboard'
import {
  getAllGenres,
  getChildGenres,
  getGenreBySlug,
  searchGenres,
  upsertGenre,
} from './db/queries/genres'
import * as jobQueries from './db/queries/jobs'
import { getOwnedAlbumKeys } from './db/queries/library-albums'
import {
  getLibraryHealthState,
  markLibraryHealthScanFailed,
  markLibraryHealthScanStarted,
  saveLibraryHealthState,
} from './db/queries/library-health'
import { deleteExpiredPendingOAuth } from './db/queries/oauth-pending'
import { getOAuthToken } from './db/queries/oauth-tokens'
import {
  getPlaylistWithTracks,
  getScheduledPlaylists,
  replacePlaylistTracks,
  updatePlaylist as updatePlaylistRow,
} from './db/queries/playlists'
import {
  bulkRejectRecommendations,
  bulkUpdateStatus,
  filterOwnedIds,
  getExistingAlbumReleaseGroupMbids,
  getExistingRecommendationMbids,
  getGenreFeedbackHistory,
  getRecommendation,
  getRejectedArtistMbids,
  insertRecommendation,
  listRecommendations,
  listRecommendationsForExport,
  listWaitingApprovals,
  rejectRecommendation,
  updateRecommendationStatus,
} from './db/queries/recommendations'
import { sessionQueries } from './db/queries/sessions'
import type { SetupConfig } from './db/queries/settings'
import {
  completeSetup,
  getDigestDeliveryPositions,
  getSettings,
  initializeDigestDeliveryPositions,
  initializeExperimentalIntegrations,
  isSetupComplete,
  setDigestDeliveryPosition,
  updateSettings,
} from './db/queries/settings'
import { completeSetupWithServices } from './db/queries/setup'
import {
  createSlskdJob,
  findActiveSlskdJobByWorkKey,
  listPendingSlskdJobs,
  listSlskdJobsForRecommendationTarget,
  updateSlskdJobState,
} from './db/queries/slskd-jobs'
import {
  createSubscription,
  deleteSubscription,
  getEnabledSubscriptions,
  getSubscription,
  getSubscriptionBatchStats,
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
  getUserByOidcIdentity,
  getUserByUsername,
  getUserConnections,
  getUserCount,
  listUsers,
  updateUser,
  updateUserConnections,
  updateUserPreferredLocale,
} from './db/queries/users'
import {
  artists,
  DEFAULT_PREFERENCES,
  libraryArtists,
  mergePreferences,
  recommendationBatches,
} from './db/schema'
import { waitForDatabase } from './db/wait'
import { createApp } from './server'
import { resolveUserPreferences } from './server/helpers/preferences'

// Job recording - initialized after DB setup, before createApp()
let jobRecorder: import('./core/jobs/types').JobRecorder

// Initialize encryption before any DB operations.
initEncryption(envConfig.encryptionKey, envConfig.encryptionKeyNext)
if (isEncryptionEnabled()) {
  if (envConfig.encryptionKeyNext) {
    console.log('Field-level encryption enabled (dual-key rotation mode)')
  } else {
    console.log('Field-level encryption enabled')
  }
} else if (process.env.NODE_ENV === 'production') {
  console.warn(
    'WARNING: DIGARR_ENCRYPTION_KEY is not set - API keys and tokens are stored as plaintext in the database. Set this variable for production security.',
  )
} else {
  console.log('Field-level encryption disabled (set DIGARR_ENCRYPTION_KEY to enable)')
}

// Wait for Postgres to accept connections before any DB operation. A
// slow-starting Postgres (still in recovery) rejects with SQLSTATE 57P03;
// without this guard the first query rejects and kills the process,
// crash-looping the pod on kubelet until PG finishes recovery.
// PGlite is in-process (no pool); only Postgres needs to wait for a socket.
if (pool) await waitForDatabase(pool)

// Pre-flight check: detect pending migrations and auto-backup if needed.
await runPreFlightCheck(db)

// Run pending database migrations before anything else.
// Idempotent; selects the migrator matching the active backend.
await runMigrations()
console.log('Database migrations applied')
await initializeExperimentalIntegrations(db)

const legacyEncrypted = await encryptLegacyPlaintext(db)
if (legacyEncrypted > 0) {
  console.log(`Encrypted ${legacyEncrypted} stored value(s) saved before encryption was enabled`)
}

try {
  await bootstrapInitialAdmin(db, envConfig)
} catch {
  console.error(
    'Initial admin bootstrap failed. On first boot, set both DIGARR_INITIAL_USERNAME and DIGARR_INITIAL_PASSWORD with a password of at least 12 characters. Verify database availability before restarting.',
  )
  try {
    await closeDb()
  } finally {
    process.exit(1)
  }
}

// Wire up DB-backed session store after migrations are applied.
setSessionStore(sessionQueries(db))

// Read library sync interval once; used by both the orchestrator's stale
// check and the background scheduler. Runtime changes require a restart.
const bootSettings = await getSettings(db)
const librarySyncIntervalHours = bootSettings?.librarySyncIntervalHours ?? 6

const librarySyncStore = createLibrarySyncStore(db)

async function getDiscoveryConnectionSnapshot(userId: number) {
  const [userConnections, spotifyToken, deezerToken, tidalToken, hasLibrarySync] =
    await Promise.all([
      getUserConnections(db, userId),
      getOAuthToken(db, userId, 'spotify'),
      getOAuthToken(db, userId, 'deezer'),
      getOAuthToken(db, userId, 'tidal'),
      librarySyncStore.userHasAnySyncState(userId),
    ])

  return {
    hasListenBrainz: Boolean(
      userConnections?.listenbrainzUsername && userConnections.listenbrainzToken,
    ),
    hasSpotify: isConnectedToken(spotifyToken),
    spotifyScopes: spotifyToken?.scopes?.split(' ').filter(Boolean) ?? [],
    hasLastfm: Boolean(userConnections?.lastfmUsername && userConnections.lastfmApiKey),
    hasDiscogs: Boolean(userConnections?.discogsUsername && userConnections.discogsToken),
    hasDeezer: isConnectedToken(deezerToken),
    hasTidal: isConnectedToken(tidalToken),
    hasLibrarySync,
    hasSubsonic: Boolean(
      userConnections?.subsonicUrl &&
        userConnections.subsonicUsername &&
        userConnections.subsonicPassword,
    ),
  }
}

const storeDb: StoreDb = {
  getExistingAlbumReleaseGroupMbids: (userId, options) =>
    getExistingAlbumReleaseGroupMbids(db, userId, options),
  getBlockedAlbumKeys: (userId) => getBlockedAlbumKeys(db, userId),
  getOwnedAlbumKeys: (userId) => getOwnedAlbumKeys(db, userId),
  getArtistGenreCacheByMbids: (mbids) => getArtistGenreCacheByMbids(db, mbids),
  getArtistGenreCacheByAliases: (aliases) => getArtistGenreCacheByAliases(db, aliases),
  upsertArtistGenres: (data) => upsertArtistGenres(db, data),
  upsertArtistGenreAlias: (data) => upsertArtistGenreAlias(db, data),
  getExistingRecommendationMbids: (userId, options) =>
    getExistingRecommendationMbids(db, userId, options),
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
    await completeBatch(db, id, { ...stats, filtered: 0 })
  },
  failBatch: async (id) => {
    await failBatch(db, id)
  },
  upsertArtist: async (data) => {
    const row = await upsertArtist(db, data)
    return { id: row.id }
  },
  insertRecommendation: (data) => insertRecommendation(db, data),
  saveRecommendationChunk: (entries) => saveRecommendationChunk(db, entries),
  // Atomic pair: prevents orphaned artist rows when the followup insert fails
  upsertArtistAndRecommendation: async (artistData, recData) => {
    await db.transaction(async (tx) => {
      const row = await upsertArtist(tx, artistData)
      await insertRecommendation(tx, { ...recData, artistId: row.id })
    })
  },
  getRejectedMbids: (cooldownDays, userId) => getRejectedArtistMbids(db, cooldownDays, userId),
  getBlockedMbids: (userId) => getBlockedArtistMbids(db, userId),
  getBlockedArtistNames: async (userId) => {
    const names: string[] = []
    let cursor: import('./db/queries/artist-blocks').ListBlocksCursor | null = null
    do {
      const page = await listArtistBlocksQuery(db, { userId, limit: 200, cursor })
      names.push(...page.items.map((artist) => artist.name))
      cursor = page.nextCursor
    } while (cursor)
    return names
  },
  getFeedbackHistory: (userId) => getGenreFeedbackHistory(db, userId),
  lookupArtistMetadata: (name) => lookupByName(db, name),
  getPopularityMap: (names) => getPopularityMap(db, names),
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
  userHasOwnSyncState: (userId) => librarySyncStore.userHasOwnSyncState(userId),
  tryConsumeRateLimit: (key, config) => tryConsume(db, key, config),
}

jobRecorder = createJobRecorder(db)
const scrobblerWriteBack = createScrobblerWriteBack({
  getPreferences: async (userId) => (await getUserById(db, userId))?.preferences,
  getConnections: (userId) => getUserConnections(db, userId),
  getLastFmSession: (userId) => getOAuthToken(db, userId, 'lastfm'),
  recorder: jobRecorder,
  lastfmSharedSecret: () => envConfig.lastfmSharedSecret,
  encryptionEnabled: isEncryptionEnabled,
})
// Close out jobs and batches a previous process left 'running' so they do not wait for the stuck detector
markInterruptedJobs(db)
  .then((n) => {
    if (n > 0) console.warn(`[startup] Marked ${n} job(s) interrupted by a restart as failed`)
  })
  .catch((err) => console.error('[startup] Interrupted-job cleanup failed:', err))
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

// Subscription and playlist runs write to the DB, so shutdown waits on them before closeDb.
const inFlightJobs = new Set<Promise<unknown>>()
function trackInFlight<T>(run: Promise<T>): Promise<T> {
  inFlightJobs.add(run)
  const done = () => inFlightJobs.delete(run)
  run.then(done, done)
  return run
}

const slskdOrchestrator = createSlskdOrchestrator({
  listTargets: async () => {
    const [rows, settings] = await Promise.all([getAllTargets(db), getSettings(db)])
    return rows.map((row) => withResolvedLidarrConnection(row, settings))
  },
  createSlskdClient: (url, apiKey, skipTlsVerify) => createSlskdClient(url, apiKey, skipTlsVerify),
  createLidarrClient: (url, apiKey, skipTlsVerify) =>
    createLidarrClient(url, apiKey, skipTlsVerify),
  findActiveJobByWorkKey: (workKey) => findActiveSlskdJobByWorkKey(db, workKey),
  createJob: (input) => createSlskdJob(db, input),
  listPendingJobs: (limit) => listPendingSlskdJobs(db, limit),
  updateJobState: (id, state, extra) => updateSlskdJobState(db, id, state, extra),
  updateRecommendationAction: (id, targetId, status, error) =>
    updateSlskdRecommendationAction(
      {
        getRecommendation: (id) => getRecommendation(db, id),
        listJobs: (id, targetId) => listSlskdJobsForRecommendationTarget(db, id, targetId),
        update: (id, status, extra) => updateRecommendationStatus(db, id, status, extra),
      },
      id,
      targetId,
      status,
      error,
    ),
})
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
  // Reads throw too: an empty library would make an unconfigured Lidarr look healthy.
  async function getClient() {
    const s = await getSettings(db)
    if (s?.lidarrUrl && s?.lidarrApiKey) {
      return createLidarrClient(s.lidarrUrl, s.lidarrApiKey, s.skipTlsVerify ?? false)
    }
    throw new Error('Lidarr not configured')
  }

  return {
    getArtists: async () => (await getClient()).getArtists(),
    getAlbums: async (artistId: number) => (await getClient()).getAlbums(artistId),
    lookupArtist: async (term: string) => (await getClient()).lookupArtist(term),
    setArtistsMonitored: async (artistIds: number[], monitored: boolean) =>
      (await getClient()).setArtistsMonitored(artistIds, monitored),
    triggerCommand: async (name: string, body?: Record<string, unknown>) =>
      (await getClient()).triggerCommand(name, body),
    getRootFolders: async () => (await getClient()).getRootFolders(),
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
    updateWikidataEnrichment: async (mbid, data) => {
      await db.update(artists).set(data).where(eq(artists.mbid, mbid))
    },
  },
  stateStore: {
    get: () => getLibraryHealthState(db),
    markScanStarted: () => markLibraryHealthScanStarted(db),
    save: ({ checks, lastCompletedAt, lastError }) =>
      saveLibraryHealthState(db, { checks, lastCompletedAt, lastError }),
    markScanFailed: (error) => markLibraryHealthScanFailed(db, error),
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
    sources.push(
      createPlexLibrarySource(
        createPlexClient(conns.plexUrl, conns.plexToken, { sectionId: conns.plexSectionId }),
        userId,
      ),
    )
  }
  if (conns.jellyfinUrl && conns.jellyfinApiKey && conns.jellyfinUserId) {
    sources.push(
      createJellyfinLibrarySource(
        createJellyfinClient(conns.jellyfinUrl, conns.jellyfinApiKey, conns.jellyfinUserId, {
          libraryId: conns.jellyfinLibraryId,
        }),
        userId,
      ),
    )
  }
  if (conns.embyUrl && conns.embyApiKey && conns.embyUserId) {
    sources.push(
      createEmbyLibrarySource(
        createEmbyClient(conns.embyUrl, conns.embyApiKey, conns.embyUserId, {
          libraryId: conns.embyLibraryId,
        }),
        userId,
      ),
    )
  }
  if (conns.subsonicUrl && conns.subsonicUsername && conns.subsonicPassword) {
    sources.push(
      createSubsonicLibrarySource(
        createSubsonicClient(conns.subsonicUrl, conns.subsonicUsername, conns.subsonicPassword),
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
        { requireFiles: s.preferences?.lidarrRequireFiles !== false },
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
    getEnabledTargets: () => getEnabledTargetsForResolvedUser(resolvedUserId),
  })
}

async function buildDiscoveryModePipelineDeps(userId: number) {
  const settings = await getSettings(db)
  if (!settings) {
    throw new Error('Settings not found')
  }

  const [userConnections, user] = await Promise.all([
    getUserConnections(db, userId),
    getUserById(db, userId),
  ])
  const userPreferences = await resolveUserPreferences(
    async () => user,
    settings.preferences,
    userId,
  )

  let spotifyAccessToken: string | null = null
  try {
    spotifyAccessToken = await resolveProviderToken(db, userId, 'spotify')
  } catch {
    // Best-effort: discovery mode runs should still work without Spotify.
  }

  const autoApproveDeps: import('./core/pipeline/auto-approve').AutoApproveDeps = {
    getRecommendationsByBatch: async (batchId: number) => {
      const result = await listRecommendations(db, { batchId, limit: 1000 })
      return result.items.map((recommendation) => ({
        id: recommendation.id,
        score: recommendation.score,
        status: recommendation.status,
        kind: recommendation.kind,
        recommendedReleaseGroupId: recommendation.recommendedReleaseGroupId,
        artist: {
          mbid: recommendation.artist.mbid,
          name: recommendation.artist.name,
        },
      }))
    },
    getEnabledTargets: () => getEnabledTargetsForResolvedUser(userId, userPreferences),
    userId,
    jobRecorder,
    ...(user && user.approvalPolicy !== 'direct'
      ? { canApprove: async (score: number) => !requiresApprovalRequest(user, score) }
      : {}),
    updateRecommendationStatus: (
      id: number,
      status: string,
      extra?: Parameters<typeof updateRecommendationStatus>[3],
    ) => updateRecommendationStatus(db, id, status, extra),
    warmArtist: skyhookWarmer
      ? (
          (warmer) => (mbid: string) =>
            warmer.warm(mbid)
        )(skyhookWarmer)
      : undefined,
  }

  return {
    settings,
    pipelineDeps: {
      db: storeDb,
      settings: {
        ...settings,
        preferences: mergePreferences(userPreferences),
        audiomuse: getAudioMuseConfig(settings.preferences),
        spotifyAccessToken,
      },
      providerRegistry,
      userConnections,
      autoApproveDeps,
      librarySync: librarySyncOrchestrator,
    },
  }
}

const executeDiscoveryModeRun = async (
  request: import('./core/discovery-modes/request').DiscoveryModeRequest,
  options?: { existingJobId?: number },
) => {
  const { pipelineDeps } = await buildDiscoveryModePipelineDeps(request.userId)

  return runDiscoveryMode({
    request,
    registry: discoveryModeRegistry,
    orchestrator,
    pipelineDeps,
    jobRecorder,
    existingJobId: options?.existingJobId,
  })
}

async function getEnabledTargetsForResolvedUser(
  userId: number,
  resolvedPreferences?: Partial<import('./db/schema').Preferences> | null,
): Promise<import('./core/targets/types').DestinationTarget[]> {
  const rows = await getTargetsByUser(db, userId)
  const settings = await getSettings(db)
  // Server-connection defaults: the owner's preferences, falling back to global.
  const serverDefaults = mergePreferences(
    resolvedPreferences !== undefined
      ? resolvedPreferences
      : await resolveUserPreferences(db, settings?.preferences ?? null, userId),
  )

  const targets: import('./core/targets/types').DestinationTarget[] = []
  for (const row of rows) {
    if (!row.enabled) continue
    if (row.type === 'lidarr') {
      const connection = resolveLidarrTargetConnection(row.config, settings)
      targets.push(
        createLidarrTarget(row.id, {
          ...(connection ?? {}),
          ...resolveLidarrTargetDefaults(row.config, serverDefaults),
        }),
      )
    }

    if (row.type === 'slskd') {
      const client = createSlskdClient(
        row.config.url as string,
        row.config.apiKey as string,
        (row.config.skipTlsVerify as boolean) ?? false,
      )
      const musicBrainz = createMusicBrainzClient()
      const runner = createSlskdRunner({
        resolveReleaseGroups: async (artistMbid) => {
          const releaseGroups = await musicBrainz.getReleaseGroups(artistMbid)
          return releaseGroups.map((releaseGroup) => ({
            releaseGroupMbid: releaseGroup.id,
            releaseTitle: releaseGroup.title,
          }))
        },
        findActiveJob: (workKey) => findActiveSlskdJobByWorkKey(db, workKey),
        createJob: (input) => createSlskdJob(db, input),
      })

      targets.push(
        createSlskdTarget(row.id, {
          name: row.name,
          linkedLidarrTargetId:
            row.config.lidarrTargetId != null
              ? `lidarr-${Number(row.config.lidarrTargetId)}`
              : undefined,
          testConnection: () => client.testConnection(),
          queueArtist: (input) => runner.queueArtist(input),
          queueAlbum: (input) => runner.queueAlbum(input),
        }),
      )
    }

    if (row.type === 'spotify-playlist') {
      targets.push(
        createSpotifyPlaylistTarget(row.id, {
          getAccessToken: () => resolveProviderToken(db, userId, 'spotify'),
        }),
      )
    }
  }

  return targets
}

// Shared subscription query facade (used both by routes and scheduler)
const subscriptionQueriesImpl = {
  createSubscription: (data: Parameters<typeof createSubscription>[1]) =>
    createSubscription(db, data),
  getSubscription: (id: number) => getSubscription(db, id),
  getSubscriptionsByUser: (userId: number, opts?: Parameters<typeof getSubscriptionsByUser>[2]) =>
    getSubscriptionsByUser(db, userId, opts),
  getEnabledSubscriptions: () => getEnabledSubscriptions(db),
  updateSubscription: (id: number, data: Parameters<typeof updateSubscription>[2]) =>
    updateSubscription(db, id, data),
  deleteSubscription: (id: number) => deleteSubscription(db, id),
}

// Cache adapter registries per user - building one per execution is redundant when
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

function executeSubscription(subscriptionId: number): Promise<void> {
  return trackInFlight(runSubscriptionById(subscriptionId))
}

async function runSubscriptionById(subscriptionId: number): Promise<void> {
  const sub = await getSubscription(db, subscriptionId)
  if (!sub) {
    console.warn(`[subscription-runner] Subscription ${subscriptionId} not found - skipping`)
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

  const rejectedMbids = await storeDb.getRejectedMbids(prefs.rejectionCooldownDays, sub.userId)
  const blockedMbids = sub.userId ? await storeDb.getBlockedMbids(sub.userId) : new Set<string>()
  const feedbackHistory = sub.userId
    ? await storeDb.getFeedbackHistory(sub.userId)
    : await storeDb.getFeedbackHistory()

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
  // Cache is keyed by userId with a 60s TTL - short enough that credential
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

    // Last.fm adapters - only if the user has a Last.fm API key
    if (lfApiKey) {
      adapterRegistry.register(createLastfmTagAdapter({ apiKey: lfApiKey }))
      adapterRegistry.register(createLastfmChartsAdapter({ apiKey: lfApiKey }))
    }

    // ListenBrainz adapter - only if the user has LB credentials
    if (lbUsername && lbToken) {
      adapterRegistry.register(createListenBrainzAdapter({ username: lbUsername, token: lbToken }))
    }

    // Spotify adapters - only if the user has a stored OAuth token
    if (userId !== null && userId !== undefined) {
      const spotifyOAuthRow = await getOAuthToken(db, userId, 'spotify')
      if (spotifyOAuthRow) {
        const getToken = () => resolveProviderToken(db, userId, 'spotify')
        adapterRegistry.register(createSpotifyLikedSongsAdapter({ getToken }))
        adapterRegistry.register(createSpotifyPlaylistAdapter({ getToken }))
        adapterRegistry.register(createSpotifyChartsAdapter({ getToken }))
      }
    }

    // Keep disconnected subscriptions runnable so the failure reaches Job History.
    adapterRegistry.register(
      createDeezerAdapter({
        getToken: async () => {
          if (userId === null || userId === undefined) {
            throw new Error('Deezer subscription has no owner; recreate it under your account')
          }
          return resolveProviderToken(db, userId, 'deezer')
        },
      }),
    )

    setCachedAdapterRegistry(userId ?? null, adapterRegistry)
  }

  const adapter = adapterRegistry.get(sub.sourceType)
  if (!adapter && sub.sourceType !== DISCOVERY_MODE_SUBSCRIPTION_TYPE) {
    console.warn(
      `[subscription-runner] Unknown type '${sub.sourceType}' for subscription ${subscriptionId} - skipping`,
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

  await runSubscription(
    subscriptionConfig,
    (adapter ?? {
      type: DISCOVERY_MODE_SUBSCRIPTION_TYPE,
      fetch: async () => ({ artists: [] }),
    }) as import('./core/subscriptions/types').SubscriptionAdapter,
    {
      db: storeDb,
      queries: {
        updateSubscription: (id, data) => updateSubscription(db, id, data),
        getBatchStats: (batchId) => getSubscriptionBatchStats(db, batchId),
      },
      jobRecorder,
      mbClient: createMusicBrainzClient() as SubMBClient,
      lidarr: lidarrClient ?? undefined,
      userId: sub.userId ?? undefined,
      libraryMbids,
      libraryGenres,
      rejectedMbids,
      blockedMbids,
      feedbackHistory,
      cooldownDays: prefs.rejectionCooldownDays,
      defaultScoreThreshold: prefs.scoreThreshold,
      topArtistNames,
      discoveryModeRegistry,
      getDiscoveryConnectionSnapshot,
      pipelineOrchestrator: orchestrator,
      discoveryModePipelineDeps:
        sub.userId != null
          ? (await buildDiscoveryModePipelineDeps(sub.userId)).pipelineDeps
          : undefined,
    },
  )
}

async function executePlaylistGeneration(
  playlistId: number,
  trigger: PlaylistGenerationTrigger,
): Promise<void> {
  return trackInFlight(
    withPlaylistLock(playlistId, () => generatePlaylistContents(playlistId, trigger)),
  )
}

async function generatePlaylistContents(
  playlistId: number,
  trigger: PlaylistGenerationTrigger,
): Promise<void> {
  let jobId: number | null = null

  const result = await getPlaylistWithTracks(db, playlistId)
  if (!result) {
    console.warn(`[playlist-scheduler] Playlist ${playlistId} not found - skipping`)
    return
  }

  const playlist = result.playlist

  try {
    jobId = await jobRecorder.start({
      type: 'playlist',
      userId: playlist.userId ?? undefined,
      metadata: {
        playlistId: playlist.id,
        playlistName: playlist.name,
        strategy: playlist.strategy,
      },
    })

    // Approvals are per user; an ownerless playlist would regenerate empty.
    if (playlist.userId == null) {
      throw new Error('Playlist has no owner; kept the previous tracks')
    }
    const strategyDeps = buildStrategyDeps(db, playlist.userId)
    const resolverDeps = await buildPlaylistResolverDeps(db, playlist.userId)
    const generation = await generatePlaylist(
      playlist.strategy as import('./db/schema').PlaylistStrategy,
      playlist.config,
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

    if (jobId != null) {
      await jobQueries.updateJobMetadata(db, jobId, {
        playlistResolution: generation.resolution,
      })
    }

    // A resolver outage would otherwise replace a good playlist with an empty or thin one.
    const failure = playlistGenerationFailure(generation.resolution)
    if (failure) throw new Error(`${failure}; kept the previous tracks`)

    await replacePlaylistTracks(db, playlist.id, trackInserts)
    await updatePlaylistRow(db, playlist.id, {
      lastGeneratedAt: new Date(),
      trackCount: generation.tracks.length,
    })

    void trackInFlight(
      scrobblerWriteBack.generatedPlaylist(
        playlist.userId,
        playlist.name,
        generation.tracks,
        trigger,
      ),
    )

    if (playlist.targetIds.length > 0 && playlist.userId != null) {
      const userId = playlist.userId
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
        spotifyUri: track.spotifyUri ?? undefined,
      }))

      const targets: Array<{ targetId: number; target: DestinationTarget; targetName: string }> = []
      for (const targetRow of enabledTargetRows) {
        const target = createSavedPlaylistExportTarget(targetRow, {
          globalSkipTlsVerify,
          getSpotifyAccessToken: () => resolveProviderToken(db, userId, 'spotify'),
        })
        if (target) targets.push({ targetId: targetRow.id, target, targetName: targetRow.name })
      }

      await pushSavedPlaylistToTargets(
        targets,
        playlist.name,
        playlistItems,
        createSavedPlaylistExportStore(db, userId, playlist.id),
        async (playlistExports) => {
          if (jobId != null) await jobQueries.updateJobMetadata(db, jobId, { playlistExports })
        },
      )
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
      await recordFailureSafely(jobRecorder, jobId, errMsg(err))
    }
    throw err
  }
}

async function restartPlaylistScheduler(): Promise<void> {
  const settings = await getSettings(db)
  const enabled = mergePreferences(settings?.preferences).playlistEnabled ?? false
  schedulePlaylists(playlistScheduler, {
    enabled,
    playlists: enabled ? await getScheduledPlaylists(db) : [],
    generate: (playlistId) => executePlaylistGeneration(playlistId, 'scheduled'),
  })
}

// One invalid stored cron must not stop the remaining schedulers from starting.
function scheduleIsolated(label: string, start: () => void): void {
  try {
    start()
  } catch (err: unknown) {
    console.error(`[scheduler] ${label} not scheduled:`, errMsg(err))
  }
}

let librarySyncCron: Cron | null = null
let libraryHealthCron: Cron | null = null
let approvalRetryCron: Cron | null = null
let slskdCron: Cron | null = null
let stuckDetectorCron: Cron | null = null
let digestNotifierCron: Cron | null = null

function restartLibraryMaintenanceScheduler(intervalHours: number): void {
  librarySyncCron?.stop()
  libraryHealthCron?.stop()

  librarySyncCron = startLibrarySyncScheduler({
    intervalHours,
    orchestrator: librarySyncOrchestrator,
    listUserIds: async () => (await listUsers(db)).map((u) => u.id),
  })
  libraryHealthCron = startLibraryHealthScheduler({
    intervalHours,
    libraryHealth,
    isConfigured: async () => {
      const s = await getSettings(db)
      return Boolean(s?.lidarrUrl && s?.lidarrApiKey)
    },
  })
}

const digestDeliveryInFlight = { running: false }

function buildDigestDeps() {
  return {
    getDigestCron: async () => mergePreferences((await getSettings(db))?.preferences).digestCron,
    getChannels: async () =>
      decryptChannelSecrets(mergePreferences((await getSettings(db))?.preferences).channels ?? []),
    getStats: (since: Date) => jobQueries.getDigestStats(db, since),
    dispatch,
    initializeDeliveryPositions: (channelIds: string[]) =>
      initializeDigestDeliveryPositions(db, channelIds),
    getDeliveryPositions: () => getDigestDeliveryPositions(db),
    setDeliveryPosition: (channelId: string, at: Date) =>
      setDigestDeliveryPosition(db, channelId, at),
    inFlight: digestDeliveryInFlight,
  }
}

async function restartDigestNotifier(): Promise<void> {
  digestNotifierCron?.stop()
  digestNotifierCron = await startDigestNotifier(buildDigestDeps())
}

// Lazy OIDC service getter - reads current settings from DB on each call,
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

// Static search sources - no auth required, safe to build once at startup.
function buildStaticSearchSources(): SearchSource[] {
  return [
    createMusicBrainzSearchSource(createMusicBrainzClient()),
    createDeezerSearchSource(createDeezerClient()),
    createBandcampSearchSource(createBandcampClient()),
  ]
}

const staticSearchSources = buildStaticSearchSources()
const discoveryModeRegistry = createDefaultDiscoveryModeRegistry()

const app = createApp({
  db,
  storeDb,
  orchestrator,
  scheduler,
  providerRegistry,
  isSetupComplete: () => isSetupComplete(db),
  getSettings: () => getSettings(db),
  updateSettings: (partial) => updateSettings(db, partial),
  completeSetup: (config, services) => completeSetupWithServices(db, config, services),
  getLastBatch: async () => {
    const batches = await listBatches(db)
    return batches[0] ?? null
  },
  listRecommendations: (filters) => listRecommendations(db, filters),
  listRecommendationsForExport: (filters) => listRecommendationsForExport(db, filters),
  getRecommendation: (id) => getRecommendation(db, id),
  updateRecommendationStatus: (id, status, extra) =>
    updateRecommendationStatus(db, id, status, extra),
  rejectRecommendation: (params) => rejectRecommendation(db, params),
  listArtistBlocks: (params) => listArtistBlocksQuery(db, params),
  removeArtistBlock: (params) => removeArtistBlockQuery(db, params),
  addArtistBlock: (params) =>
    addArtistBlockQuery(db, {
      userId: params.userId,
      artistId: params.artistId,
      reason: params.reason ?? null,
      reasonText: params.reasonText ?? null,
      source: 'manual',
    }),
  listAlbumBlocks: (userId) => listAlbumBlocksQuery(db, userId),
  removeAlbumBlock: (params) => removeAlbumBlockQuery(db, params),
  bulkUpdateStatus: (ids, status) => bulkUpdateStatus(db, ids, status),
  bulkRejectRecommendations: (params) => bulkRejectRecommendations(db, params),
  filterOwnedIds: (ids, userId) => filterOwnedIds(db, ids, userId),
  listBatches: (opts?: Parameters<typeof listBatches>[1]) => listBatches(db, opts),
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
  restartLibraryMaintenanceScheduler,
  restartDigestNotifier,
  createUser: (data, options) => createUser(db, data, options),
  getUserByUsername: (username) => getUserByUsername(db, username),
  getUserById: (id) => getUserById(db, id),
  getUserCount: () => getUserCount(db),
  updateUserPreferredLocale: (id, preferredLocale) =>
    updateUserPreferredLocale(db, id, preferredLocale),
  getOidcService,
  getUserByOidcIdentity: (issuer, subject) => getUserByOidcIdentity(db, issuer, subject),
  getUserByEmail: (email) => getUserByEmail(db, email),
  updateUser: (id, data) => updateUser(db, id, data),
  listUsers: (opts?: Parameters<typeof listUsers>[1]) => listUsers(db, opts),
  deleteUser: (id) => deleteUser(db, id),
  genreService,
  libraryHealth,
  skyhookWarmer,
  librarySync: librarySyncOrchestrator,
  librarySyncStore,
  slskdOrchestrator,
  albumCoverage,
  subscriptionQueries: subscriptionQueriesImpl,
  runSubscription: (id) => executeSubscription(id),
  targetQueries: {
    createTarget: (data: TargetInsert) => createTarget(db, data),
    getTargetsByUser: (userId: number, opts?: Parameters<typeof getTargetsByUser>[2]) =>
      getTargetsByUser(db, userId, opts),
    getAllTargets: (opts?: Parameters<typeof getAllTargets>[1]) => getAllTargets(db, opts),
    getTarget: (id: number) => getTarget(db, id),
    updateTarget: (id: number, data: Parameters<typeof updateTarget>[2]) =>
      updateTarget(db, id, data),
    deleteTarget: (id: number) => deleteTarget(db, id),
  },
  testTargetConnection: async (type, config) => {
    const resolved = withResolvedLidarrConnection({ type, config }, await getSettings(db))
    return testTargetConnection(type, resolved.config)
  },
  getFeedbackHistory: (userId) => getGenreFeedbackHistory(db, userId),
  dashboardQueries: {
    getTopGenresForUser: (userId) => getTopGenresForUser(db, userId),
    getLatestGenreCoverage: (userId) => getLatestGenreCoverage(db, userId),
    getRecentActivity: (userId, isAdmin, limit) => getRecentActivity(db, userId, isAdmin, limit),
  },
  discoveryModeRegistry,
  runDiscoveryMode: executeDiscoveryModeRun,
  getDiscoveryConnectionSnapshot,
  jobRecorder,
  jobQueries: {
    listJobs: (filters) => jobQueries.listJobs(db, filters),
    getJobById: (id) => jobQueries.getJobById(db, id),
    getJobHealth: (nextRun) => jobQueries.getJobHealth(db, nextRun),
    getJobsForSubscription: (subId, limit) => jobQueries.getJobsForSubscription(db, subId, limit),
  },
  getEnabledTargetsForUser: (userId) => getEnabledTargetsForResolvedUser(userId),
  scrobblerWriteBack: {
    approvedTrack: (userId, track) =>
      trackInFlight(scrobblerWriteBack.approvedTrack(userId, track)),
    generatedPlaylist: (userId, title, tracks, trigger) =>
      trackInFlight(scrobblerWriteBack.generatedPlaylist(userId, title, tracks, trigger)),
  },
  playlistDeps: {
    db,
    playlistScheduler,
    runPlaylistGeneration: (playlistId) => executePlaylistGeneration(playlistId, 'manual'),
    restartPlaylistScheduler,
  },
  search: {
    listSources: async (userId) => {
      const spotifyOAuth = userId ? await getOAuthToken(db, userId, 'spotify') : null
      const storedSettings = await getSettings(db)
      return buildSearchSourceCatalog({
        hasSpotifyOAuth: Boolean(spotifyOAuth),
        showExperimentalIntegrations:
          storedSettings?.preferences?.showExperimentalIntegrations ?? false,
        hasTidalSearch: Boolean(storedSettings?.tidalClientId && storedSettings?.tidalClientSecret),
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
              getToken: () => resolveProviderToken(db, searchUserId, 'spotify'),
            }),
          )
        }
      }
      const storedSettings = await getSettings(db)
      if (storedSettings?.tidalClientId && storedSettings?.tidalClientSecret) {
        sources.push(
          createTidalSearchSource(
            createTidalClient({
              clientId: storedSettings.tidalClientId,
              clientSecret: storedSettings.tidalClientSecret,
            }),
          ),
        )
      }

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

// Auto-complete setup from env vars, then start scheduler
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

    // Backfill: create a Lidarr target for existing installations, then link
    // copies of the server connection to it (#994).
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
            config: { useServerConnection: true },
            userId: admin.id,
          })
          console.log('[boot] Created Lidarr target from existing settings (migration backfill)')
        }
      }
      const linked = await linkLidarrTargetsToServerConnection(settings, {
        listLidarrTargets: () => getTargetsByType(db, 'lidarr'),
        updateTargetConfig: (id, config) => updateTarget(db, id, { config }),
      })
      if (linked.length > 0) {
        console.log(`[boot] Linked ${linked.length} Lidarr target(s) to the server connection`)
      }
    }

    // Start schedulers - single getSettings() call shared across all
    const prefs = mergePreferences(settings?.preferences)
    const cron = prefs.scheduleCron
    if (cron) {
      scheduleIsolated('main pipeline', () => {
        scheduler.schedule('main-pipeline', cron, runPipeline)
        console.log(`Scheduler started with cron: ${cron}`)
      })
    }

    const subs = await getEnabledSubscriptions(db)
    for (const sub of subs) {
      scheduleIsolated(`subscription ${sub.id}`, () => {
        scheduler.schedule(`subscription-${sub.id}`, sub.cron, () => executeSubscription(sub.id))
        console.log(`Subscription '${sub.name}' (id=${sub.id}) scheduled with cron: ${sub.cron}`)
      })
    }

    await restartPlaylistScheduler()

    // Library maintenance schedulers - background, idempotent. Boot fire is non-blocking.
    restartLibraryMaintenanceScheduler(librarySyncIntervalHours)
    // Fire one sync + health scan at boot so fresh installs don't wait for the first cron tick.
    // Delayed so the first page loads after a restart do not compete with these.
    setTimeout(() => {
      void librarySyncOrchestrator
        .syncGlobal()
        .catch((err) => console.error('[boot] initial library syncGlobal failed:', err))
      libraryHealth.startScan()
      void slskdOrchestrator.warmup()
    }, 60_000).unref()
    slskdCron = new Cron('*/10 * * * *', async () => {
      if (isMaintenance()) {
        console.log('[slskd-scheduler] tick skipped: maintenance in progress')
        return
      }
      try {
        await slskdOrchestrator.triggerSync()
      } catch (err) {
        console.error('[slskd-scheduler] tick failed:', err)
      }
    })

    approvalRetryCron = new Cron('*/5 * * * *', { protect: true }, async () => {
      if (isMaintenance()) return
      try {
        await retryWaitingApprovals({
          listWaiting: () => listWaitingApprovals(db),
          getRecommendation: (id) => getRecommendation(db, id),
          getTargets: getEnabledTargetsForResolvedUser,
          isBlocked: async (rec) => {
            if (rec.userId == null) return false
            const [artists, albums] = await Promise.all([
              getBlockedArtistMbids(db, rec.userId),
              getBlockedAlbumKeys(db, rec.userId),
            ])
            return (
              artists.has(rec.artist.mbid) ||
              Boolean(rec.recommendedReleaseGroupId && albums.has(rec.recommendedReleaseGroupId))
            )
          },
          update: (id, status, extra) => updateRecommendationStatus(db, id, status, extra),
          recorder: jobRecorder,
          getLocale: async (userId) =>
            resolveSupportedLocale((await getUserById(db, userId))?.preferredLocale),
          notify: async (payload) =>
            dispatch(await buildDigestDeps().getChannels(), 'approval_failed', payload),
        })
      } catch (error) {
        console.error('[lidarr-retry] tick failed:', errMsg(error))
      }
    })

    // Start stuck job detector
    stuckDetectorCron = startStuckDetector(jobRecorder)

    // Start scheduled notification digest (no-op until digestCron is configured)
    try {
      digestNotifierCron = await startDigestNotifier(buildDigestDeps())
    } catch (err: unknown) {
      console.error('[scheduler] digest notifier not scheduled:', errMsg(err))
    }
  } catch (err: unknown) {
    console.error('Failed to initialize:', err)
  }
})()

// Clean up expired sessions and abandoned OAuth authorizations every 6 hours.
// Both are already rejected on read; this only stops the rows accumulating.
setInterval(
  async () => {
    if (isMaintenance()) return
    try {
      await sessionQueries(db).deleteExpired()
      await deleteExpiredPendingOAuth(db)
    } catch {
      /* best-effort cleanup */
    }
  },
  6 * 60 * 60 * 1000,
)

console.log(`Digarr running on http://localhost:${port}`)
if (!envConfig.allowedOrigin && process.env.NODE_ENV === 'production') {
  console.warn(
    'ALLOWED_ORIGIN not set - CORS rejects all cross-origin requests, the Secure cookie and same-origin/CSRF checks fall back to the request URL (login or mutations can fail behind a proxy), and OIDC and TIDAL redirect URIs cannot be built. Set ALLOWED_ORIGIN to your public origin.',
  )
}
if (envConfig.authToken && envConfig.authToken.length < 16) {
  console.warn(
    'DIGARR_AUTH_TOKEN is shorter than 16 characters - this is trivially brute-forceable. Use a longer token.',
  )
}
if (envConfig.authToken) {
  console.warn(
    'DEPRECATED: DIGARR_AUTH_TOKEN provides read-only access with no admin privileges, no per-user features, and no audit trail. Create personal API tokens in Settings > Account instead. See docs/AUTHENTICATION.md#personal-api-tokens.',
  )
}
if (!envConfig.authToken && !envConfig.initialUsername) {
  console.warn(
    'No DIGARR_AUTH_TOKEN or DIGARR_INITIAL_USERNAME set - the API is unauthenticated until the first user registers. Set one for production security.',
  )
}

// Graceful shutdown - flip readiness, drain, wait for in-flight work, exit
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    console.log(`${signal} received, shutting down...`)
    // Flip /health to 503 so kube-proxy / ingress stop routing traffic
    // to this pod. Wait long enough for the default Kubernetes probe cadence
    // to observe draining before closing the server so
    // in-flight requests finish on the listener we still own.
    markShuttingDown()
    setMaintenance(true)
    await new Promise((resolve) => setTimeout(resolve, 12_000))
    scheduler.stopAll()
    playlistScheduler.stopAll()
    approvalRetryCron?.stop()
    slskdCron?.stop()
    stuckDetectorCron?.stop()
    digestNotifierCron?.stop()
    librarySyncCron?.stop()
    libraryHealthCron?.stop()
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
    if (inFlightJobs.size > 0) {
      console.log(`Waiting for ${inFlightJobs.size} subscription/playlist run(s) to finish...`)
      await Promise.race([
        (async () => {
          while (inFlightJobs.size > 0) await Promise.allSettled([...inFlightJobs])
        })(),
        new Promise((resolve) => setTimeout(resolve, 25_000)),
      ])
    }
    await waitForGenreWarmers()
    await closeDb()
    clearTimeout(deadline)
    process.exit(0)
  })
}
