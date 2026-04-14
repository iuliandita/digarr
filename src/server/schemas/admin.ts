import { z } from 'zod'

// Backup data table rows are shape-heterogeneous (22 tables, mixed schemas),
// so each table is typed as an array of records. restoreBackup is the
// authoritative filter for column-level validation; this schema catches
// the prototype pollution surface (non-array `data.*`, wrong top-level
// types) before restore logic runs.
const tableArray = z.array(z.record(z.string(), z.unknown()))

export const backupDataSchema = z
  .object({
    settings: tableArray,
    users: tableArray,
    oauthTokens: tableArray,
    oidcTokens: tableArray,
    targets: tableArray,
    subscriptions: tableArray,
    jobRuns: tableArray,
    recommendationBatches: tableArray,
    recommendations: tableArray,
    playlists: tableArray,
    playlistTracks: tableArray,
    artists: tableArray.optional(),
    genres: tableArray.optional(),
    artistMetadata: tableArray.optional(),
  })
  .passthrough()

export const backupFileSchema = z.object({
  version: z.number().int().positive(),
  appVersion: z.string().min(1),
  createdAt: z.string().min(1),
  encryptionKeyHash: z.string().nullable(),
  includesCaches: z.boolean(),
  data: backupDataSchema,
})

export type BackupFileInput = z.infer<typeof backupFileSchema>
