import { Cron } from 'croner'
import * as z from 'zod'

// Cron string: any expression croner can parse. Validate by construction
// attempt so the error surfaces at the schema boundary instead of later.
export const cronSchema = z
  .string()
  .trim()
  .min(1, 'cron expression is required')
  .max(100)
  .refine(
    (value) => {
      try {
        new Cron(value, { maxRuns: 0 })
        return true
      } catch {
        return false
      }
    },
    { message: 'Invalid cron expression' },
  )

export const subscriptionIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const listenerRangeSchema = z.object({
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional(),
})

// sourceConfig varies per sourceType (discovery-mode-config, spotify-playlist
// id, deezer feedType+playlistIds, etc.). Adapters own the inner shape;
// here we only gate that it is an object and impose an overall size ceiling.
const sourceConfigSchema = z.record(z.string(), z.unknown())

export const createSubscriptionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sourceType: z.string().trim().min(1).max(64),
  sourceProvider: z.string().trim().min(1).max(64),
  sourceConfig: sourceConfigSchema,
  cron: cronSchema,
  enabled: z.boolean().optional(),
  maxArtistsPerRun: z.number().int().min(1).max(1000).optional(),
  listenerRange: listenerRangeSchema.optional(),
  scoringWeightPreset: z.string().max(64).optional(),
})

export const updateSubscriptionSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    sourceConfig: sourceConfigSchema.optional(),
    maxArtistsPerRun: z.number().int().min(1).max(1000).optional(),
    listenerRange: listenerRangeSchema.optional(),
    cron: cronSchema.optional(),
    scoreThreshold: z.number().min(0).max(1).optional(),
    scoringWeightPreset: z.string().max(64).optional(),
    scoringWeightOverrides: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const bulkToggleSchema = z.object({
  enabled: z.boolean(),
})

export const deezerPlaylistImportSchema = z.object({
  playlistIds: z
    .array(z.union([z.number().int(), z.string().regex(/^\d+$/)]))
    .min(1)
    .max(100),
})

export const spotifyPlaylistImportSchema = z.object({
  playlistId: z.string().trim().min(1).max(100),
})
