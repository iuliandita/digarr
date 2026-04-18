import * as z from 'zod'

// Minimal fields required to add an artist: foreignArtistId (MBID) and
// artistName. Profile/folder IDs fall back to sensible defaults when omitted.
export const lidarrAddSchema = z
  .object({
    foreignArtistId: z.string().min(1),
    artistName: z.string().min(1),
    qualityProfileId: z.number().int().positive().optional(),
    metadataProfileId: z.number().int().positive().optional(),
    rootFolderId: z.number().int().positive().optional(),
  })
  .strict()

export type LidarrAddInput = z.infer<typeof lidarrAddSchema>
