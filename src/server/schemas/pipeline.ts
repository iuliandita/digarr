import * as z from 'zod'

// normalizeDiscoveryModeRequest is the authoritative parser for the body
// shape; schema here catches gross mismatches (wrong types on the top-level
// fields) before it runs. The nested settings objects are adapter-specific
// and stay permissive. The parser ignores other keys, including a legacy `settings`.
export const discoveryModeRunSchema = z
  .object({
    modeId: z.string().trim().min(1).max(100).optional(),
    settingsMode: z.string().max(64).optional(),
    rawUserSettings: z.record(z.string(), z.unknown()).optional(),
    normalizedSettings: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export const quickDiscoverSchema = z.object({
  artistName: z.string().trim().min(1).max(200),
})
