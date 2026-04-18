import * as z from 'zod'
import { passwordSchema, usernameSchema } from './auth'

export const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  isAdmin: z.boolean().optional().default(false),
})

// PATCH body: only admin role is mutable here today. Keep shape strict so
// future additions are a deliberate choice, not a silent expansion.
export const updateUserSchema = z
  .object({
    isAdmin: z.boolean().optional(),
  })
  .strict()

export const userIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})
