import * as z from 'zod'
import { passwordSchema, usernameSchema } from './auth'
import { idParamSchema } from './validator'

const approvalPolicy = z.enum(['direct', 'request_only', 'auto_approve'])
const maxOpenRequests = z.number().int().min(0).max(2147483647).nullable()
const approvalThreshold = z.number().min(0).max(1).nullable()

export const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  isAdmin: z.boolean().optional().default(false),
  approvalPolicy: approvalPolicy.optional(),
  maxOpenRequests: maxOpenRequests.optional(),
  approvalThreshold: approvalThreshold.optional(),
})

export const updateUserSchema = z
  .object({
    isAdmin: z.boolean().optional(),
    approvalPolicy: approvalPolicy.optional(),
    maxOpenRequests: maxOpenRequests.optional(),
    approvalThreshold: approvalThreshold.optional(),
  })
  .strict()

export const userIdParamSchema = idParamSchema
