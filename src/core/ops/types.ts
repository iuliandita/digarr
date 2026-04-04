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
  oidcTokens: Record<string, unknown>[]
  targets: Record<string, unknown>[]
  subscriptions: Record<string, unknown>[]
  subscriptionRuns: Record<string, unknown>[]
  recommendationBatches: Record<string, unknown>[]
  recommendations: Record<string, unknown>[]
  playlists: Record<string, unknown>[]
  playlistTracks: Record<string, unknown>[]
  // Optional caches
  artists?: Record<string, unknown>[]
  genres?: Record<string, unknown>[]
  artistMetadata?: Record<string, unknown>[]
}

export interface RestoreResult {
  tablesRestored: Record<string, number>
  warnings: string[]
  encryptionMismatch: boolean
  affectedEncryptedFields: string[]
}

export interface BackupOptions {
  includeCaches?: boolean
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
    path: string
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
