import type { Database } from '@/db'

// ── Backup ──────────────────────────────────────

export interface BackupFile {
  version: number
  appVersion: string
  createdAt: string
  encryptionKeyHash: string | null
  includesCaches: boolean
  data: BackupData
}

export interface BackupData {
  settings: Record<string, unknown>[]
  users: Record<string, unknown>[]
  oauthTokens: Record<string, unknown>[]
  oidcTokens?: Record<string, unknown>[]
  targets: Record<string, unknown>[]
  subscriptions: Record<string, unknown>[]
  jobRuns: Record<string, unknown>[]
  recommendationBatches: Record<string, unknown>[]
  recommendations: Record<string, unknown>[]
  playlists: Record<string, unknown>[]
  playlistTracks: Record<string, unknown>[]
  playlistExports?: Record<string, unknown>[]
  artistBlocks: Record<string, unknown>[]
  // Optional in legacy backups; included by every new backup.
  artists?: Record<string, unknown>[]
  artistGenreAliases?: Record<string, unknown>[]
  genres?: Record<string, unknown>[]
  // Optional metadata cache.
  artistMetadata?: Record<string, unknown>[]
  // Optional in legacy/selective backups; included by default.
  albumBlocks?: Record<string, unknown>[]
  libraryArtists?: Record<string, unknown>[]
  libraryAlbums?: Record<string, unknown>[]
  librarySyncState?: Record<string, unknown>[]
  libraryMatchOverrides?: Record<string, unknown>[]
  libraryAlbumMatchOverrides?: Record<string, unknown>[]
  libraryHealthState?: Record<string, unknown>[]
  recordingArtistCache?: Record<string, unknown>[]
  slskdJobs?: Record<string, unknown>[]
}

export interface RestoreResult {
  tablesRestored: Record<string, number>
  warnings: string[]
  encryptionMismatch: boolean
  affectedEncryptedFields: string[]
}

export interface BackupOptions {
  includeCaches?: boolean
  full?: boolean
}

export interface RestoreOptions {
  force?: boolean
}

// ── Hygiene ─────────────────────────────────────

export interface HygieneResult {
  tool: string
  [key: string]: unknown
}

export interface AiAuditResult {
  scanned: number
  flagged: number
  flaggedIds: number[]
  autoFixStarted: boolean
}

export interface AiAuditStatus {
  flaggedIds: number[]
  fixedIds: number[]
  inProgress: boolean
}

// ── Upgrade ─────────────────────────────────────

export interface MigrationStatus {
  currentVersion: string | null
  targetVersion: string | null
  pendingCount: number
  pendingMigrations: string[]
  lastAutoBackup: {
    filename: string
    createdAt: string
  } | null
}

export interface PreFlightResult {
  pendingCount: number
  backupPath: string | null
  backupSkipped: boolean
  backupError: string | null
}

// ── Shared ──────────────────────────────────────

export type OpsDb = Database
