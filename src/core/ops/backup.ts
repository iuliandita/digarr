import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getKeyFingerprint } from '@/core/crypto'
import {
  artistMetadata,
  artists,
  genres,
  oauthTokens,
  oidcTokens,
  playlists,
  playlistTracks,
  recommendationBatches,
  recommendations,
  settings,
  subscriptionRuns,
  subscriptions,
  targets,
  users,
} from '@/db/schema'
import type { BackupFile, BackupOptions, OpsDb } from './types'

function getAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

// biome-ignore lint/suspicious/noExplicitAny: drizzle table type is opaque
async function selectAll(db: OpsDb, table: any): Promise<Record<string, unknown>[]> {
  return db.select().from(table) as unknown as Record<string, unknown>[]
}

export async function createBackup(db: OpsDb, options: BackupOptions = {}): Promise<BackupFile> {
  const { includeCaches = false } = options

  const [
    settingsRows,
    userRows,
    oauthRows,
    oidcRows,
    targetRows,
    subRows,
    subRunRows,
    batchRows,
    recRows,
    playlistRows,
    trackRows,
  ] = await Promise.all([
    selectAll(db, settings),
    selectAll(db, users),
    selectAll(db, oauthTokens),
    selectAll(db, oidcTokens),
    selectAll(db, targets),
    selectAll(db, subscriptions),
    selectAll(db, subscriptionRuns),
    selectAll(db, recommendationBatches),
    selectAll(db, recommendations),
    selectAll(db, playlists),
    selectAll(db, playlistTracks),
  ])

  const backup: BackupFile = {
    version: 1,
    appVersion: getAppVersion(),
    createdAt: new Date().toISOString(),
    encryptionKeyHash: getKeyFingerprint(),
    includesCaches: includeCaches,
    data: {
      settings: settingsRows,
      users: userRows,
      oauthTokens: oauthRows,
      oidcTokens: oidcRows,
      targets: targetRows,
      subscriptions: subRows,
      subscriptionRuns: subRunRows,
      recommendationBatches: batchRows,
      recommendations: recRows,
      playlists: playlistRows,
      playlistTracks: trackRows,
    },
  }

  if (includeCaches) {
    const [artistRows, genreRows, metaRows] = await Promise.all([
      selectAll(db, artists),
      selectAll(db, genres),
      selectAll(db, artistMetadata),
    ])
    backup.data.artists = artistRows
    backup.data.genres = genreRows
    backup.data.artistMetadata = metaRows
  }

  return backup
}
