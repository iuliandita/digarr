import * as z from 'zod'
import { REJECTION_REASONS } from '@/core/recommendations/rejection-reasons'
import { stripControlChars } from '@/core/text/strip-control-chars'

// MAX_BULK_IDS caps the bulk write surface so one approve-all payload cannot
// starve the worker. 500 matches the Spotify CSV import truncation ceiling.
const MAX_BULK_IDS = 500

export const recommendationIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export const recommendationStatusSchema = z.enum(['approved', 'rejected', 'pending'])
export const approvalModeSchema = z.enum(['single_target', 'combined_lidarr_slskd'])
export const monitorOptionSchema = z.enum(['all', 'new', 'none', 'selected', 'popular'])
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
  // Reject-only fields. Strict refinement applied via rejectStatusSchema below.
  reason: z.enum(REJECTION_REASONS).optional(),
  reasonText: z.string().max(400).optional(),
  permanent: z.boolean().optional(),
})

export const bulkRecommendationSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(MAX_BULK_IDS),
  action: z.enum(['approve', 'reject']),
  targetId: z.string().optional(),
  qualityProfileId: z.number().int().optional(),
  metadataProfileId: z.number().int().optional(),
  rootFolderId: z.number().int().optional(),
})

// PATCH /api/v1/recommendations/:id/status payload (when status='rejected'):
// captures structured reason + optional freeform text + permanent-block flag.
// Refine rules mirror the UI invariants.
export const rejectStatusSchema = z
  .object({
    status: z.literal('rejected'),
    reason: z.enum(REJECTION_REASONS).nullish(),
    reasonText: z
      .string()
      .transform((s) => stripControlChars(s).trim())
      .pipe(z.string().max(200))
      .nullish(),
    permanent: z.boolean().default(false),
  })
  .refine((v) => !(v.permanent && v.reason === 'not_right_now'), {
    message: 'not_right_now is incompatible with permanent',
    path: ['permanent'],
  })
  .refine((v) => v.reason === 'other' || v.reasonText == null || v.reasonText === '', {
    message: 'reasonText only valid when reason=other',
    path: ['reasonText'],
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
