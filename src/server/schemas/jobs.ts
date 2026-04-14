import { z } from 'zod'

export const jobTypeSchema = z.enum([
  'pipeline',
  'quick_discover',
  'subscription',
  'target',
  'playlist',
  'library_sync',
])

export const jobStatusSchema = z.enum(['running', 'completed', 'failed', 'stuck'])

export const jobIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export const listJobsQuerySchema = z.object({
  type: jobTypeSchema.optional(),
  status: jobStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})
