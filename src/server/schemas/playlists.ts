import * as z from 'zod'
import { playlistConfigSchema } from '@/core/playlists/config'
import { cronSchema } from './subscriptions'
import { idParamSchema } from './validator'

export const playlistStrategySchema = z.enum([
  'weekly_digest',
  'genre_focus',
  'mood_mix',
  'rediscover',
  'audition',
])

export const playlistIdParamSchema = idParamSchema

export const playlistExportTargetParamSchema = idParamSchema.extend({
  targetId: z.coerce.number().int().positive(),
})

export const resetPlaylistExportSchema = z
  .object({
    acknowledgePossibleDuplicate: z.literal(true),
  })
  .strict()

export const playlistExportFormatParamSchema = idParamSchema.extend({
  format: z.enum(['json', 'csv', 'm3u', 'xspf']),
})

export const createPlaylistSchema = z.object({
  name: z.string().trim().min(1).max(200),
  strategy: playlistStrategySchema,
  targetIds: z.array(z.number().int().positive()).max(50).optional(),
  schedule: cronSchema.nullable().optional(),
  config: playlistConfigSchema.nullable().optional(),
  enabled: z.boolean().optional(),
})

export const updatePlaylistSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    strategy: playlistStrategySchema.optional(),
    targetIds: z.array(z.number().int().positive()).max(50).optional(),
    schedule: cronSchema.nullable().optional(),
    config: playlistConfigSchema.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
