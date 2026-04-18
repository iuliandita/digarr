import * as z from 'zod'
import { TARGET_TYPES } from '@/core/targets/types'

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
// validation. We only insist on url being http(s) when present.
export const targetConfigSchema = z
  .object({
    url: httpUrl.optional(),
  })
  .catchall(z.unknown())

export const createTargetSchema = z.object({
  type: z.enum(TARGET_TYPES),
  name: z.string().trim().min(1).max(200),
  config: targetConfigSchema,
})

// PATCH body: only explicitly-allowed fields. .strict() rejects unknown keys
// so future silent expansion is caught in review.
export const updateTargetSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    config: targetConfigSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

export const targetIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})
