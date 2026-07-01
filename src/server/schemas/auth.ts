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

// Set or clear the current user's email. Empty string and null both clear it;
// a non-empty value must be a valid address. Email is the key OIDC uses to
// auto-link an existing local account to an IdP identity.
export const updateEmailSchema = z
  .object({
    email: z.string().trim().max(254).email('Invalid email address').nullable().or(z.literal('')),
  })
  .strict()

// Partial preferences update. Unknown keys are filtered by the route handler
// so we stay permissive here; a stricter schema would be a breaking change
// for in-flight client code. Individual value types are validated in-handler.
export const updatePreferencesSchema = z.record(z.string(), z.unknown())
