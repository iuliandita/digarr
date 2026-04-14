import { z } from 'zod'

// Setup wizard accepts a bunch of fields, most optional, with
// conditional-require rules enforced in the handler (e.g., lidarrApiKey
// required when lidarrUrl is set). The schema normalizes types and caps
// length so opaque blobs cannot slip through.
export const setupCompleteSchema = z
  .object({
    // Global settings (filtered via allowlist in handler)
    lidarrUrl: z.string().max(2048).optional(),
    lidarrApiKey: z.string().max(200).optional(),
    skipTlsVerify: z.boolean().optional(),
    aiProvider: z.string().max(64).optional(),
    aiApiKey: z.string().max(500).optional(),
    aiModel: z.string().max(200).optional(),
    aiBaseUrl: z.string().max(2048).optional(),
    preferences: z.record(z.string(), z.unknown()).optional(),
    // Emby credentials (persisted separately on users row)
    embyUrl: z.string().max(2048).optional(),
    embyApiKey: z.string().max(200).optional(),
    embyUserId: z.string().max(200).optional(),
  })
  .passthrough()
