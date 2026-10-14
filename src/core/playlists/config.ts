import * as z from 'zod'
import type { PlaylistConfig } from '@/db/schema'

export const playlistConfigSchema = z
  .object({
    size: z.number().int().positive().default(25),
    genre: z.string().optional(),
    mood: z.string().optional(),
    trackSourcePriority: z.array(z.enum(['local', 'spotify', 'deezer'])).default(['spotify']),
  })
  .strict()

export function normalizePlaylistConfig(config: unknown): PlaylistConfig {
  return playlistConfigSchema.parse(config ?? {})
}
