import { z } from 'zod'

// normalizeDiscoveryModeRequest is the authoritative parser for the body
// shape; schema here catches gross mismatches (wrong types on the top-level
// fields) before it runs. The nested `settings` object is adapter-specific
// and stays permissive.
export const discoveryModeRunSchema = z
  .object({
    modeId: z.string().trim().min(1).max(100).optional(),
    settingsMode: z.string().max(64).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export const quickDiscoverSchema = z.object({
  artistName: z.string().trim().min(1).max(200),
})
