import * as z from 'zod'
import { stripControlChars } from '@/core/text/strip-control-chars'
import { idParamSchema } from './validator'

export const approvalRequestIdSchema = idParamSchema
export const approvalRequestDecisionSchema = z.object({
  note: z
    .string()
    .transform((value) => stripControlChars(value).trim())
    .pipe(z.string().max(1000))
    .nullable()
    .optional(),
})
