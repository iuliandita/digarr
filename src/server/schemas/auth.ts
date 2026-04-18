import * as z from 'zod'

export const usernameSchema = z
  .string()
  .trim()
  .min(2, 'Username must be 2-50 characters')
  .max(50, 'Username must be 2-50 characters')

export const passwordSchema = z.string().min(12, 'Password must be at least 12 characters')

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
})

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema.refine(
    (val) => val.length >= 12,
    'New password must be at least 12 characters',
  ),
})

export const updateLocaleSchema = z
  .object({
    preferredLocale: z.string().nullable(),
  })
  .strict()

// Login accepts anything truthy and lets the route handler decide how to
// localise the "credentials required" copy. Keep non-strict so clients
// forwarding extra analytics fields don't 400.
export const loginBodySchema = z
  .object({
    username: z.string(),
    password: z.string(),
  })
  .passthrough()

// Partial preferences update. Unknown keys are filtered by the route handler
// so we stay permissive here; a stricter schema would be a breaking change
// for in-flight client code. Individual value types are validated in-handler.
export const updatePreferencesSchema = z.record(z.string(), z.unknown())
