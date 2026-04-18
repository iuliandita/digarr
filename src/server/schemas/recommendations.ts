import * as z from 'zod'

// MAX_BULK_IDS caps the bulk write surface so one approve-all payload cannot
// starve the worker. 500 matches the Spotify CSV import truncation ceiling.
const MAX_BULK_IDS = 500

export const recommendationIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export const recommendationStatusSchema = z.enum(['approved', 'rejected', 'pending'])
export const approvalModeSchema = z.enum(['single_target', 'combined_lidarr_slskd'])
export const monitorOptionSchema = z.enum(['all', 'new', 'none', 'selected'])
export const sortSchema = z.enum(['score_desc', 'score_asc', 'created_desc', 'acted_on_desc'])

export const updateRecommendationSchema = z.object({
  status: recommendationStatusSchema,
  approvalMode: approvalModeSchema.optional(),
  lidarrTargetId: z.string().optional(),
  monitorOption: monitorOptionSchema.optional(),
  selectedAlbumIds: z.array(z.string()).max(200).optional(),
  targetId: z.string().optional(),
  qualityProfileId: z.number().int().optional(),
  metadataProfileId: z.number().int().optional(),
  rootFolderId: z.number().int().optional(),
})

export const bulkRecommendationSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(MAX_BULK_IDS),
  action: z.enum(['approve', 'reject']),
  targetId: z.string().optional(),
  qualityProfileId: z.number().int().optional(),
  metadataProfileId: z.number().int().optional(),
  rootFolderId: z.number().int().optional(),
})

// GET /api/recommendations query: permissive (optional, empty strings tolerated)
// so existing frontend URLs keep working.
export const listRecommendationsQuerySchema = z.object({
  batchId: z.coerce.number().int().positive().optional(),
  status: z.string().max(200).optional(),
  decades: z.string().max(100).optional(),
  sort: sortSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})
