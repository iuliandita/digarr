import { resetPlaywrightDatabase } from './db-env'

const databaseUrl = await resetPlaywrightDatabase()
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl
}

await import('../../../src/index')
