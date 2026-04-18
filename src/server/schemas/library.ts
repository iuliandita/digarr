import * as z from 'zod'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Keep the batch cap in lockstep with the runtime slice in library.ts.
export const libraryWarmSchema = z
  .object({
    mbids: z.array(z.string().min(1)).min(1).max(200),
  })
  .strict()

export const librarySyncSchema = z
  .object({
    source: z.string().min(1).optional(),
  })
  .strict()

export const libraryOverrideSchema = z
  .object({
    source: z.string().min(1),
    sourceArtistId: z.string().min(1),
    // Empty string or null clear the override; otherwise must be a UUID.
    correctMbid: z
      .union([
        z.literal(''),
        z.null(),
        z.string().regex(UUID_RE, 'correctMbid must be a valid UUID'),
      ])
      .optional(),
    note: z.string().optional(),
  })
  .strict()

export const libraryAlbumOverrideSchema = z
  .object({
    source: z.string().min(1),
    sourceAlbumId: z.string().min(1),
    correctAlbumMbid: z
      .union([
        z.literal(''),
        z.null(),
        z.string().regex(UUID_RE, 'correctAlbumMbid must be a valid UUID'),
      ])
      .optional(),
    note: z.string().optional(),
  })
  .strict()

// Placeholder exports retained for future route refactors; centralising here
// so routes don't have to reinvent the shape.
export const libraryResolveSchema = librarySyncSchema
export const libraryCoverageParamSchema = z
  .object({ artistMbid: z.string().regex(UUID_RE) })
  .strict()
export const libraryCoverageQuerySchema = z.object({}).strict()
