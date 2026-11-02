import * as z from 'zod'
import { LIDARR_NEW_ITEM_MONITOR_TYPES } from '@/core/targets/types'

// Minimal fields required to add an artist: foreignArtistId (MBID) and
// artistName. Profile/folder IDs fall back to sensible defaults when omitted.
export const lidarrAddSchema = z
  .object({
    foreignArtistId: z.string().min(1),
    artistName: z.string().min(1),
    qualityProfileId: z.number().int().positive().optional(),
    metadataProfileId: z.number().int().positive().optional(),
    rootFolderId: z.number().int().positive().optional(),
    tags: z.array(z.number().int().positive()).max(100).optional(),
    monitorOption: z
      .enum(['all', 'new', 'missing', 'existing', 'latest', 'first', 'none'])
      .optional(),
    monitorNewItems: z.enum(LIDARR_NEW_ITEM_MONITOR_TYPES).optional(),
  })
  .strict()

export const approveOptionsQuerySchema = z.object({
  targetId: z.coerce.number().int().positive().optional(),
})

export const lidarrTagSchema = z.object({ label: z.string().trim().min(1).max(100) }).strict()
