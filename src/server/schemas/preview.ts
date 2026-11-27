import { z } from 'zod'

export const applePreviewQuerySchema = z.object({
  /** The artist's name, for the name search when there is no Apple artist ID. */
  name: z.string().trim().min(1).max(200),
  /** Apple artist ID, as parsed from the artist's Apple Music link. */
  id: z
    .string()
    .regex(/^\d{1,15}$/)
    .optional(),
})
