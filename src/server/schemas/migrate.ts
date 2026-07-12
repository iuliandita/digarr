import * as z from 'zod'

export const migrateTargetSchema = z.discriminatedUnion('backend', [
  z.object({
    backend: z.literal('pglite'),
    path: z.string().min(1).max(1024),
  }),
  z.object({
    backend: z.literal('postgres'),
    dsn: z
      .string()
      .min(1)
      .max(2048)
      .refine((s) => {
        try {
          const u = new URL(s)
          return u.protocol === 'postgres:' || u.protocol === 'postgresql:'
        } catch {
          return false
        }
      }, 'Must be a postgres:// or postgresql:// connection string'),
  }),
])

export const migrateRequestSchema = z.object({
  target: migrateTargetSchema,
  overwrite: z.boolean().optional(),
})
