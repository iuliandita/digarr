import * as z from 'zod'

export const moodDiscoverSchema = z
  .object({
    query: z.string().min(1, 'query is required').max(500, 'query must be 500 characters or less'),
  })
  .strict()
