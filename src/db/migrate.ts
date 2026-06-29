import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { db, dbBackend } from './index'

/** Apply pending migrations from ./drizzle using the backend's migrator. */
export async function runMigrations(): Promise<void> {
  const opts = { migrationsFolder: './drizzle' }
  if (dbBackend === 'postgres') {
    await migratePg(db as never, opts)
  } else {
    await migratePglite(db as never, opts)
  }
}
