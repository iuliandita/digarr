import * as z from 'zod'

// Inner preferences object. Enforces numeric ranges where they exist and
// keeps every field optional so partial PATCH merges stay ergonomic. Strict
// shape (no passthrough) rejects unknown keys up front so a hostile or buggy
// admin client cannot inflate the preferences jsonb with arbitrary garbage.
// Every key here must stay in lockstep with Preferences in src/db/schema.ts.
const scoringWeightsSchema = z
  .object({
    consensus: z.number().min(0).max(1).optional(),
    similarity: z.number().min(0).max(1).optional(),
    genreOverlap: z.number().min(0).max(1).optional(),
    aiConfidence: z.number().min(0).max(1).optional(),
    feedbackBoost: z.number().min(0).max(1).optional(),
    popularity: z.number().min(0).max(1).optional(),
  })
  .strict()

const preferencesSchema = z
  .object({
    qualityProfileId: z.number().int().optional(),
    metadataProfileId: z.number().int().optional(),
    rootFolderId: z.number().int().optional(),
    scheduleCron: z.string().optional(),
    scoreThreshold: z.number().min(0).max(1).optional(),
    scoringWeights: scoringWeightsSchema.optional(),
    rejectionCooldownDays: z.number().int().min(0).optional(),
    topArtistsLimit: z.number().int().min(1).optional(),
    librarySeedRatio: z.number().min(0).max(1).optional(),
    webhookUrl: z.string().optional(),
    lidarrPublicUrl: z.string().optional(),
    autoApproveEnabled: z.boolean().optional(),
    autoApproveThreshold: z.number().min(0).max(1).optional(),
    autoApproveMonitorOption: z.enum(['all', 'new', 'none']).optional(),
    playlistSize: z.number().int().min(1).optional(),
    playlistSchedule: z.string().optional(),
    playlistEnabled: z.boolean().optional(),
    dismissedHints: z.array(z.string()).optional(),
    subscriptionMode: z.enum(['active', 'ai-only']).nullable().optional(),
    fanartApiKey: z.string().optional(),
    metadataFallbackUrl: z.string().optional(),
  })
  .strict()

// PATCH body for /api/settings. Every field optional - it's a partial update.
// Unknown top-level keys are silently stripped (matches the existing allowlist
// behavior). Per-field types prevent accidental string-where-number bugs from
// the UI or curl.
export const updateSettingsSchema = z.object({
  // Lidarr (global, admin-only in handler)
  lidarrUrl: z.string().optional(),
  lidarrApiKey: z.string().optional(),
  skipTlsVerify: z.boolean().optional(),
  librarySyncIntervalHours: z.number().int().min(1).max(24).optional(),

  // AI (global, admin-only)
  aiProvider: z.string().optional(),
  aiApiKey: z.string().optional(),
  aiModel: z.string().optional(),
  aiBaseUrl: z.string().optional(),

  // Preferences (nested)
  preferences: preferencesSchema.optional(),

  // OIDC (global, admin-only)
  oidcIssuerUrl: z.string().optional(),
  oidcClientId: z.string().optional(),
  oidcClientSecret: z.string().optional(),
  oidcScopes: z.string().optional(),

  // Per-user connection fields (persisted on users table; user-scoped)
  listenbrainzUsername: z.string().nullable().optional(),
  listenbrainzToken: z.string().nullable().optional(),
  lastfmUsername: z.string().nullable().optional(),
  lastfmApiKey: z.string().nullable().optional(),
  plexUrl: z.string().nullable().optional(),
  plexToken: z.string().nullable().optional(),
  jellyfinUrl: z.string().nullable().optional(),
  jellyfinApiKey: z.string().nullable().optional(),
  jellyfinUserId: z.string().nullable().optional(),
  embyUrl: z.string().nullable().optional(),
  embyApiKey: z.string().nullable().optional(),
  embyUserId: z.string().nullable().optional(),
  discogsToken: z.string().nullable().optional(),
  discogsUsername: z.string().nullable().optional(),
})
