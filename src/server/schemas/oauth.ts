import * as z from 'zod'

// Initiate body is optional overall (Deezer branch reads env config only),
// but if any field is set for the Spotify branch, all three must be strings.
// Handler still enforces "all three required" after the switch so this schema
// stays lenient.
export const oauthInitiateSchema = z
  .object({
    clientId: z.string().max(500).optional(),
    clientSecret: z.string().max(500).optional(),
    redirectUri: z
      .string()
      .max(2048)
      .refine((v) => v.startsWith('http://') || v.startsWith('https://'), {
        message: 'redirectUri must start with http:// or https://',
      })
      .optional(),
  })
  .passthrough()

export const oauthProviderParamSchema = z.object({
  provider: z.enum(['spotify', 'deezer']),
})
