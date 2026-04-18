import * as z from 'zod'
import { cronSchema } from './subscriptions'

export const playlistStrategySchema = z.enum([
  'weekly_digest',
  'genre_focus',
  'mood_mix',
  'rediscover',
])

export const playlistIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export const playlistExportFormatParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  format: z.enum(['json', 'csv', 'm3u', 'xspf']),
})

export const createPlaylistSchema = z.object({
  name: z.string().trim().min(1).max(200),
  strategy: playlistStrategySchema,
  targetIds: z.array(z.number().int().positive()).max(50).optional(),
  schedule: cronSchema.nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  enabled: z.boolean().optional(),
})

export const updatePlaylistSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    strategy: playlistStrategySchema.optional(),
    targetIds: z.array(z.number().int().positive()).max(50).optional(),
    schedule: cronSchema.nullable().optional(),
    config: z.record(z.string(), z.unknown()).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
