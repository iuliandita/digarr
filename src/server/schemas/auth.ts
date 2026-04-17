import { z } from 'zod'

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

export const updateLocaleSchema = z.object({
  preferredLocale: z.string().nullable(),
})
