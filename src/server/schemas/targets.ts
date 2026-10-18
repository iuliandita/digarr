import * as z from 'zod'
import { TARGET_TYPES } from '@/core/targets/types'
import { idParamSchema } from './validator'

// URL must be http(s). Private-IP / SSRF checks live in handlers and
// outbound HTTP clients (publicIpOnly) - schema just enforces the scheme.
export const httpUrl = z
  .string()
  .trim()
  .refine((v) => v.startsWith('http://') || v.startsWith('https://'), {
    message: 'URL must start with http:// or https://',
  })

// Config is deliberately loose: each target type has its own shape managed by
// the adapter. Pinning per-type config here would duplicate adapter-side
// validation. Save schemas also require an import path for linked slskd targets.
export const targetConfigSchema = z
  .object({
    url: httpUrl.optional(),
    tags: z.array(z.number().int().positive()).max(100).optional(),
  })
  .catchall(z.unknown())

export const targetSaveConfigSchema = z
  .object({ type: z.enum(TARGET_TYPES), config: z.record(z.string(), z.unknown()) })
  .superRefine(({ type, config }, ctx) => {
    if (
      type === 'slskd' &&
      config.lidarrTargetId != null &&
      (typeof config.lidarrDownloadPath !== 'string' || !config.lidarrDownloadPath.trim())
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'lidarrDownloadPath'],
        message:
          'Set the Lidarr download path in the slskd target settings when a Lidarr target is linked',
      })
    }
  })

export const createTargetSchema = targetSaveConfigSchema.safeExtend({
  config: targetConfigSchema,
  name: z.string().trim().min(1).max(200),
  userId: z.number().int().positive().optional(),
})

// PATCH body: only explicitly-allowed fields. .strict() rejects unknown keys
// so future silent expansion is caught in review.
export const updateTargetSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    config: targetConfigSchema.optional(),
    enabled: z.boolean().optional(),
    userId: z.number().int().positive().optional(),
  })
  .strict()

export const targetIdParamSchema = idParamSchema
