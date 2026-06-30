import { defineConfig } from 'drizzle-kit'

// Dev tooling for `drizzle-kit generate`/`migrate`; requires a Postgres DATABASE_URL (never run against PGlite).
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: DATABASE_URL required at runtime
    url: process.env.DATABASE_URL!,
  },
})
