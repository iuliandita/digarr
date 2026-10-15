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

export const oidcLinkSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
  })
  .strict()

export const updateLocaleSchema = z
  .object({
    preferredLocale: z.string().nullable(),
  })
  .strict()

// Email is self-asserted and never links an OIDC identity to an existing account.
export const updateEmailSchema = z
  .object({
    email: z.string().trim().max(254).email('Invalid email address').nullable().or(z.literal('')),
  })
  .strict()

// Partial preferences update. Unknown keys are filtered by the route handler
// so existing fields stay permissive for in-flight client code. New fields
// validate their value types here; genre priorities are validated in-handler.
export const updatePreferencesSchema = z
  .object({ netNewAlbumDiscovery: z.boolean().optional() })
  .passthrough()
