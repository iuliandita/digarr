import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { HealthCheckResult } from '@/core/library/types'

export type DiscoveryModeProvenance = {
  modeId: string
  settingsMode: 'easy' | 'advanced'
  providerPath: string[]
}

export type RecommendationBatchSourceConfig = Record<string, unknown> & {
  trigger?: 'manual' | 'scheduled'
  discoveryMode?: DiscoveryModeProvenance
}

export type JobMetadata = Record<string, unknown> & {
  trigger?: 'manual' | 'scheduled' | 'subscription'
  seedArtist?: string
  discoveryMode?: DiscoveryModeProvenance
}

export const settings = pgTable('settings', {
  id: serial('id').primaryKey(),
  lidarrUrl: text('lidarr_url'),
  lidarrApiKey: text('lidarr_api_key'),
  listenbrainzUsername: text('listenbrainz_username'),
  listenbrainzToken: text('listenbrainz_token'),
  lastfmUsername: text('lastfm_username'),
  lastfmApiKey: text('lastfm_api_key'),
  aiProvider: text('ai_provider'),
  aiApiKey: text('ai_api_key'),
  aiModel: text('ai_model'),
  aiBaseUrl: text('ai_base_url'),
  oidcIssuerUrl: text('oidc_issuer_url'),
  oidcClientId: text('oidc_client_id'),
  oidcClientSecret: text('oidc_client_secret'),
  oidcScopes: text('oidc_scopes'),
  skipTlsVerify: boolean('skip_tls_verify').default(false).notNull(),
  preferences: jsonb('preferences').$type<Preferences>(),
  setupComplete: boolean('setup_complete').default(false).notNull(),
  librarySyncIntervalHours: integer('library_sync_interval_hours').notNull().default(6),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const libraryHealthState = pgTable('library_health_state', {
  id: serial('id').primaryKey(),
  checks: jsonb('checks').$type<HealthCheckResult[]>().notNull().default([]),
  lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
  lastCompletedAt: timestamp('last_completed_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    username: text('username').unique().notNull(),
    passwordHash: text('password_hash').notNull(),
    isAdmin: boolean('is_admin').default(false).notNull(),
    preferredLocale: text('preferred_locale'),
    email: text('email'),
    oidcSubject: text('oidc_subject'),
    authProvider: text('auth_provider').notNull().default('local'),
    preferences: jsonb('preferences').$type<Preferences>(),
    listenbrainzUsername: text('listenbrainz_username'),
    listenbrainzToken: text('listenbrainz_token'),
    lastfmUsername: text('lastfm_username'),
    lastfmApiKey: text('lastfm_api_key'),
    plexUrl: text('plex_url'),
    plexToken: text('plex_token'),
    jellyfinUrl: text('jellyfin_url'),
    jellyfinApiKey: text('jellyfin_api_key'),
    jellyfinUserId: text('jellyfin_user_id'),
    embyUrl: text('emby_url'),
    embyApiKey: text('emby_api_key'),
    embyUserId: text('emby_user_id'),
    discogsToken: text('discogs_token'),
    discogsUsername: text('discogs_username'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    emailUniqueIdx: uniqueIndex('users_email_unique_idx')
      .on(table.email)
      .where(sql`${table.email} IS NOT NULL`),
    oidcSubjectUniqueIdx: uniqueIndex('users_oidc_subject_unique_idx')
      .on(table.oidcSubject)
      .where(sql`${table.oidcSubject} IS NOT NULL`),
  }),
)

export const genres = pgTable('genres', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  source: text('source').notNull(),
  parentGenreId: integer('parent_genre_id').references((): AnyPgColumn => genres.id),
  artistCount: integer('artist_count').default(0),
  cachedAt: timestamp('cached_at', { withTimezone: true }),
})

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    userId: integer('user_id').references(() => users.id),
    enabled: boolean('enabled').notNull().default(true),
    sourceType: text('source_type').notNull(),
    sourceProvider: text('source_provider').notNull(),
    sourceConfig: jsonb('source_config').notNull().$type<Record<string, unknown>>(),
    maxArtistsPerRun: integer('max_artists_per_run').notNull().default(20),
    listenerRange: jsonb('listener_range').$type<{ min?: number; max?: number } | null>(),
    cron: text('cron').notNull(),
    action: text('action').notNull().default('add_to_recommendations'),
    scoreThreshold: real('score_threshold'),
    scoringWeightPreset: text('scoring_weight_preset').default('default'),
    scoringWeightOverrides: jsonb('scoring_weight_overrides').$type<Record<
      string,
      number
    > | null>(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastResultCount: integer('last_result_count'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('subscriptions_user_id_idx').on(table.userId),
    enabledIdx: index('subscriptions_enabled_idx').on(table.enabled),
  }),
)

export type TopTrack = {
  name: string
  previewUrl?: string
  durationMs?: number
}

export type TopTracksCache = {
  tracks: TopTrack[]
  cachedAt: string
}

export const artists = pgTable('artists', {
  id: serial('id').primaryKey(),
  mbid: uuid('mbid').unique().notNull(),
  name: text('name').notNull(),
  disambiguation: text('disambiguation'),
  tags: text('tags').array(),
  genres: text('genres').array(),
  imageUrl: text('image_url'),
  logoUrl: text('logo_url'),
  streamingUrls: jsonb('streaming_urls').$type<Record<string, string>>(),
  imageFailedAt: timestamp('image_failed_at', { withTimezone: true }),
  cachedAt: timestamp('cached_at', { withTimezone: true }),
  beginYear: integer('begin_year'),
  endYear: integer('end_year'),
  topTracks: jsonb('top_tracks').$type<TopTracksCache>(),
})

export const recommendationBatches = pgTable('recommendation_batches', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  sourceConfig: jsonb('source_config').$type<RecommendationBatchSourceConfig | null>(),
  stats: jsonb('stats'),
  status: text('status').notNull().default('running'),
  subscriptionId: integer('subscription_id').references(() => subscriptions.id),
})

export const recommendations = pgTable(
  'recommendations',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    artistId: integer('artist_id')
      .references(() => artists.id)
      .notNull(),
    batchId: integer('batch_id')
      .references(() => recommendationBatches.id)
      .notNull(),
    score: real('score').notNull(),
    sources: jsonb('sources').$type<Record<string, number>>(),
    aiReasoning: text('ai_reasoning'),
    status: text('status').notNull().default('pending'),
    lidarrArtistId: integer('lidarr_artist_id'),
    lidarrError: text('lidarr_error'),
    recommendedReleaseGroupId: text('recommended_release_group_id'),
    recommendedReleaseGroupTitle: text('recommended_release_group_title'),
    targetActions: jsonb('target_actions').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    actedOnAt: timestamp('acted_on_at', { withTimezone: true }),
  },
  (table) => ({
    batchIdx: index('recommendations_batch_idx').on(table.batchId),
    artistIdx: index('recommendations_artist_idx').on(table.artistId),
    userStatusScoreIdx: index('recommendations_user_status_score_idx').on(
      table.userId,
      table.status,
      table.score,
    ),
    userCreatedIdx: index('recommendations_user_created_idx').on(table.userId, table.createdAt),
    userActedOnIdx: index('recommendations_user_acted_on_idx').on(table.userId, table.actedOnAt),
    statusActedOnIdx: index('recommendations_status_acted_on_idx').on(
      table.status,
      table.actedOnAt,
    ),
  }),
)

export const jobRuns = pgTable('job_runs', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(), // 'pipeline' | 'quick_discover' | 'subscription' | 'target' | 'playlist'
  status: text('status').notNull(), // 'running' | 'completed' | 'failed' | 'stuck'
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  error: text('error'),
  metadata: jsonb('metadata').$type<JobMetadata>().notNull().default({}),
  sourceResults: jsonb('source_results'),
  subscriptionId: integer('subscription_id').references(() => subscriptions.id, {
    onDelete: 'set null',
  }),
  batchId: integer('batch_id').references(() => recommendationBatches.id, { onDelete: 'set null' }),
})

export const targets = pgTable(
  'targets',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('targets_user_id_idx').on(table.userId),
    typeIdx: index('targets_type_idx').on(table.type),
  }),
)

export const SLSKD_ACTIVE_JOB_STATES = [
  'pending',
  'searching',
  'queued',
  'downloading',
  'import_pending',
] as const

export const slskdJobs = pgTable(
  'slskd_jobs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    targetId: integer('target_id')
      .references(() => targets.id, { onDelete: 'cascade' })
      .notNull(),
    recommendationId: integer('recommendation_id').references(() => recommendations.id, {
      onDelete: 'set null',
    }),
    sourceType: text('source_type').notNull(),
    workKey: text('work_key').notNull(),
    artistMbid: uuid('artist_mbid').notNull(),
    artistName: text('artist_name').notNull(),
    releaseGroupMbid: text('release_group_mbid'),
    releaseTitle: text('release_title').notNull(),
    lidarrArtistId: integer('lidarr_artist_id'),
    lidarrAlbumId: integer('lidarr_album_id'),
    state: text('state').notNull().default('pending'),
    confidence: real('confidence'),
    slskdSearchId: text('slskd_search_id'),
    slskdQueueId: text('slskd_queue_id'),
    slskdDownloadId: text('slskd_download_id'),
    selectedResult: jsonb('selected_result').$type<Record<string, unknown> | null>(),
    lastError: text('last_error'),
    attempts: integer('attempts').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    activeWorkKeyIdx: uniqueIndex('slskd_jobs_active_work_key_idx')
      .on(table.workKey)
      .where(
        sql`${table.state} in ('pending', 'searching', 'queued', 'downloading', 'import_pending')`,
      ),
    stateIdx: index('slskd_jobs_state_idx').on(table.state),
    userStateIdx: index('slskd_jobs_user_state_idx').on(table.userId, table.state),
  }),
)

export const sessions = pgTable(
  'sessions',
  {
    token: text('token').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    userExpiresIdx: index('sessions_user_expires_idx').on(table.userId, table.expiresAt),
    expiresIdx: index('sessions_expires_idx').on(table.expiresAt),
  }),
)

export const artistMetadata = pgTable('artist_metadata', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  nameNormalized: text('name_normalized').notNull().unique(),
  spotifyGenres: text('spotify_genres').array(),
  spotifyPopularity: integer('spotify_popularity'),
  deezerFans: integer('deezer_fans'),
  cachedAt: timestamp('cached_at', { withTimezone: true }).defaultNow(),
})

export const oidcTokens = pgTable('oidc_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  issuerUrl: text('issuer_url').notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  nonce: text('nonce'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    scopes: text('scopes'),
    clientId: text('client_id'),
    clientSecret: text('client_secret'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('oauth_tokens_user_provider').on(t.userId, t.provider)],
)

export const playlists = pgTable(
  'playlists',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    strategy: text('strategy').notNull(),
    targetIds: jsonb('target_ids').$type<number[]>().default([]).notNull(),
    schedule: text('schedule'),
    config: jsonb('config').$type<PlaylistConfig>(),
    lastGeneratedAt: timestamp('last_generated_at', { withTimezone: true }),
    trackCount: integer('track_count').default(0),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('playlists_user_id_idx').on(table.userId),
    enabledLastGeneratedIdx: index('playlists_enabled_last_generated_idx').on(
      table.enabled,
      table.lastGeneratedAt,
    ),
  }),
)

export const playlistTracks = pgTable(
  'playlist_tracks',
  {
    id: serial('id').primaryKey(),
    playlistId: integer('playlist_id')
      .references(() => playlists.id, { onDelete: 'cascade' })
      .notNull(),
    artistName: text('artist_name').notNull(),
    trackName: text('track_name'),
    mbid: text('mbid'),
    spotifyUri: text('spotify_uri'),
    deezerId: text('deezer_id'),
    localPath: text('local_path'),
    position: integer('position').notNull(),
  },
  (table) => ({
    playlistPositionIdx: index('playlist_tracks_playlist_position_idx').on(
      table.playlistId,
      table.position,
    ),
  }),
)

export type PlaylistConfig = {
  size: number // default 25
  genre?: string // for genre_focus strategy
  mood?: string // for mood_mix strategy
  trackSourcePriority: ('local' | 'spotify' | 'deezer')[]
}

export type PlaylistStrategy = 'weekly_digest' | 'genre_focus' | 'mood_mix' | 'rediscover'

export type Preferences = {
  qualityProfileId: number
  metadataProfileId: number
  rootFolderId: number
  scheduleCron: string
  scoreThreshold: number
  scoringWeights: {
    consensus: number
    similarity: number
    genreOverlap: number
    aiConfidence: number
    feedbackBoost: number
    popularity: number
  }
  rejectionCooldownDays: number
  topArtistsLimit: number
  librarySeedRatio: number // 0-1: fraction of seed artists from Lidarr library
  webhookUrl?: string
  lidarrPublicUrl?: string // browser-accessible Lidarr URL (may differ from API URL)
  autoApproveEnabled?: boolean
  autoApproveThreshold?: number // 0-1: minimum score to auto-approve
  autoApproveMonitorOption?: 'all' | 'new' | 'none'
  playlistSize?: number // default 25
  playlistSchedule?: string // cron, default '0 6 * * 1' (Monday 6am)
  playlistEnabled?: boolean // default false
  dismissedHints?: string[] // for UX hints system
  subscriptionMode?: 'active' | 'ai-only' | null
  fanartApiKey?: string
  metadataFallbackUrl?: string
}

export type ScoringWeights = Preferences['scoringWeights']

export const DEFAULT_PREFERENCES: Preferences = {
  qualityProfileId: 1,
  metadataProfileId: 1,
  rootFolderId: 1,
  scheduleCron: '0 0 * * 0',
  scoreThreshold: 0.5,
  scoringWeights: {
    consensus: 0.3,
    similarity: 0.25,
    genreOverlap: 0.2,
    aiConfidence: 0.15,
    feedbackBoost: 0.1,
    popularity: 0.0,
  },
  rejectionCooldownDays: 90,
  topArtistsLimit: 30,
  librarySeedRatio: 0.3,
  autoApproveEnabled: false,
  autoApproveThreshold: 0.8,
  autoApproveMonitorOption: 'all',
  playlistSize: 25,
  playlistSchedule: '0 6 * * 1',
  playlistEnabled: false,
  dismissedHints: [],
  subscriptionMode: null,
}

/**
 * Merge a partial/unknown preferences value with DEFAULT_PREFERENCES.
 * Handles the scoringWeights sub-object so neither level is left with
 * undefined fields when the DB row contains only a partial preference set.
 */
export function mergePreferences(raw: Partial<Preferences> | null | undefined): Preferences {
  const partial = raw ?? {}
  return {
    ...DEFAULT_PREFERENCES,
    ...partial,
    scoringWeights: {
      ...DEFAULT_PREFERENCES.scoringWeights,
      ...partial.scoringWeights,
    },
  }
}

export const libraryArtists = pgTable(
  'library_artists',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    // null = global config (Lidarr), non-null = per-user (Plex/Jellyfin/Emby)
    source: text('source').notNull(),
    // 'lidarr' | 'plex' | 'jellyfin' | 'emby'
    sourceArtistId: text('source_artist_id').notNull(),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    mbid: uuid('mbid'),
    // null when reconciliation failed; dedup query uses `WHERE mbid IS NOT NULL`
    matchMethod: text('match_method'),
    // 'mbid' | 'name_exact' | 'name_anchored' | 'name_disambiguated' | null
    matchConfidence: real('match_confidence'),
    genres: text('genres').array(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    naturalKey: uniqueIndex('library_artists_natural_key_idx').on(
      table.userId,
      table.source,
      table.sourceArtistId,
    ),
    dedupIdx: index('library_artists_dedup_idx').on(table.userId, table.mbid),
    nameIdx: index('library_artists_name_idx').on(table.userId, table.nameNormalized),
  }),
)

export const libraryAlbums = pgTable(
  'library_albums',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceAlbumId: text('source_album_id').notNull(),
    sourceArtistId: text('source_artist_id').notNull(),
    title: text('title').notNull(),
    titleNormalized: text('title_normalized').notNull(),
    albumMbid: uuid('album_mbid'),
    artistMbid: uuid('artist_mbid'),
    releaseYear: integer('release_year'),
    primaryType: text('primary_type'),
    matchMethod: text('match_method'),
    matchConfidence: real('match_confidence'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    naturalKey: uniqueIndex('library_albums_natural_key_idx').on(
      table.userId,
      table.source,
      table.sourceAlbumId,
    ),
    artistLookup: index('library_albums_artist_idx').on(table.userId, table.artistMbid),
  }),
)

export const libraryMatchOverrides = pgTable(
  'library_match_overrides',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceArtistId: text('source_artist_id').notNull(),
    correctMbid: uuid('correct_mbid'),
    // null means "this row has no MB equivalent, leave unreconciled forever"
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    naturalKey: uniqueIndex('library_match_overrides_natural_key_idx').on(
      table.userId,
      table.source,
      table.sourceArtistId,
    ),
  }),
)

export const libraryAlbumMatchOverrides = pgTable(
  'library_album_match_overrides',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceAlbumId: text('source_album_id').notNull(),
    correctAlbumMbid: uuid('correct_album_mbid'),
    // null means "treat this source album as intentionally unmatched"
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    naturalKey: uniqueIndex('library_album_match_overrides_natural_key_idx').on(
      table.userId,
      table.source,
      table.sourceAlbumId,
    ),
  }),
)

export type LibrarySyncCounts = {
  total: number
  matchedMbid: number
  matchedNameExact: number
  matchedNameAnchored: number
  matchedDisambiguated: number
  unreconciledAmbiguous: number
  unreconciledNoCandidate: number
  cacheHits: number
  mbApiCalls: number
  /** MB API calls that threw (5xx, timeout, network). Artists/albums degrade to unreconciled. */
  mbApiCallsFailed?: number
  estimatedSecondsRemaining?: number
  albumsSynced?: number
}

export const librarySyncState = pgTable(
  'library_sync_state',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    lastSyncStartedAt: timestamp('last_sync_started_at', { withTimezone: true }),
    lastSyncCompletedAt: timestamp('last_sync_completed_at', { withTimezone: true }),
    lastSyncStatus: text('last_sync_status'),
    // 'running' | 'completed' | 'failed'
    lastSyncError: text('last_sync_error'),
    lastSyncCounts: jsonb('last_sync_counts').$type<LibrarySyncCounts>(),
  },
  (table) => ({
    naturalKey: uniqueIndex('library_sync_state_natural_key_idx').on(table.userId, table.source),
  }),
)

export const recordingArtistCache = pgTable('recording_artist_cache', {
  recordingMbid: uuid('recording_mbid').primaryKey(),
  artistMbid: uuid('artist_mbid').notNull(),
  artistName: text('artist_name').notNull(),
  cachedAt: timestamp('cached_at', { withTimezone: true }).defaultNow().notNull(),
})
