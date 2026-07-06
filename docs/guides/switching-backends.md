# Switching the Database Backend

Digarr ships with an embedded PGlite database (no separate PostgreSQL required)
and supports external PostgreSQL via `DATABASE_URL` or the `DB_HOST` / `DB_USER`
/ `DB_NAME` / `DB_PASS` variables. The "Migrate Database Backend" panel in
Settings lets admins move all stateful data between the two backends in one
operation, without touching or modifying the source.

## When to use this

- **Scaling out**: embedded PGlite is single-writer and holds everything in Wasm
  memory. When your library grows large, you run multiple replicas, or you want
  the database managed independently, switch to external PostgreSQL.
- **Rolling back**: if you want to return to embedded PGlite after running on
  external PostgreSQL, the same tool runs in reverse.

The migration tool is for backend changes only. For day-to-day
point-in-time snapshots and disaster recovery, use the Backup & Restore panel
(Settings -> Administration -> Backup & Restore) instead.

---

## Prerequisites

- Admin account.
- The target backend must be reachable from the Digarr container. For PostgreSQL,
  spin up the database and create the user and database before running the
  migration.
- Aim for a low-activity window. Digarr blocks write API calls (POST / PUT /
  PATCH / DELETE) for non-migration routes while the copy runs, returning `503
  Maintenance in progress` to any writers. Read operations continue normally.
  Background schedulers (pipeline subscriptions, playlists, library sync and
  health scans, the stuck-job detector) skip their ticks while the lock is held,
  so scheduled jobs do not write during the copy. A job already running when the
  migration starts can still finish and write; wait for running jobs to complete
  before migrating.

---

## Step-by-step

### 1. Open the panel

Go to **Settings -> Administration -> Migrate Database Backend** (directly below
the Backup & Restore section). The panel shows the currently active backend.

### 2. Choose a target

Select one:

| Target | What to fill in |
|--------|----------------|
| PostgreSQL | Full connection string (DSN): `postgresql://user:pass@host:5432/dbname` |
| PGlite | Absolute path to the data directory on the container filesystem, e.g. `/app/data-new` |

For PGlite, the path must be inside the configured data root. The test step
checks this without creating any files.

The data root defaults to the parent directory of the currently active PGlite
data directory (for Docker deployments that is `/app`, since the default
`DB_PATH` is `/app/data`). To allow migration targets elsewhere -- for example
a second mounted volume -- set `DIGARR_MIGRATE_DATA_ROOT` to that directory
before starting Digarr. Paths outside the root are rejected to keep the
migration panel from writing to arbitrary container locations.

### 3. Test the connection

Click **Test connection**. This validates:

- **PostgreSQL**: that the server is reachable, credentials are accepted, and the
  database exists.
- **PGlite**: that the path is inside the allowed data root (non-destructive --
  nothing is created or written).

Fix any errors before proceeding.

### 4. Run the migration

Click **Migrate**. The operation:

1. Freezes writes on all non-migration routes and pauses background scheduler
   ticks (maintenance lock).
2. Takes a consistent, read-only snapshot of the source database inside a
   `REPEATABLE READ READ ONLY` transaction.
3. Runs schema migrations on the target (creates all tables).
4. Restores the snapshot atomically into the target.
5. Verifies every table by row count and SHA-256 content hash.
6. Releases the maintenance lock.

The source database is **never modified**. If anything goes wrong, the target is
left in a partial state and the source is intact; retry after fixing the
underlying problem.

Progress is shown inline. On a large library the copy may take a minute or two.

### 5. Read the report

On success, the panel shows a table of tables migrated and their row counts, plus
a summary of what was excluded (see below). Any mismatches between source and
target counts appear here with details.

### 6. Set the env var and restart

The panel shows the exact environment variable(s) to set for the new backend:

- **Switching to PostgreSQL**: set `DATABASE_URL` to the connection string you
  entered (e.g. `postgresql://digarr:pass@db-host:5432/digarr`). Alternatively,
  set `DB_HOST`, `DB_USER`, `DB_NAME`, and `DB_PASS` individually. For TLS,
  `DB_SSL_MODE` accepts `disable`, `require`, or `no-verify`. Note that
  Digarr's `require` performs full certificate verification -- stricter than
  libpq's `require`, which encrypts without verifying. Use `no-verify` for
  self-signed certificates.
- **Switching to PGlite**: unset `DATABASE_URL` and `DB_HOST`, then set `DB_PATH`
  to the directory path you entered (e.g. `DB_PATH=/app/data-new`).

Update your `docker-compose.yml`, Helm values, or container template, then
restart Digarr.

### 7. Verify the switch

After restart, check `GET /health`:

```sh
curl http://localhost:3000/health
```

The response includes `"dbBackend"`:

```json
{
  "status": "ok",
  "version": "...",
  "dbBackend": "postgres"
}
```

Confirm it shows `"postgres"` or `"pglite"` as expected.

---

## What is not copied

Two categories of data are intentionally excluded:

| Excluded | Effect |
|----------|--------|
| `sessions` | All users are logged out and must log in again after the restart. |
| Rate-limit counters | Login and register rate limits reset. |

Everything else -- users, recommendations, targets, connections, settings,
preferences, jobs, blocked artists, and so on -- is copied.

---

## Encryption

Migration runs in-process with the same `DIGARR_ENCRYPTION_KEY`. Encrypted
column values transfer verbatim and remain decryptable on the new backend because
the key has not changed.

Because this migration reads from the running app and writes with the same
process, both ends always share the current `DIGARR_ENCRYPTION_KEY`, so a key
mismatch cannot arise here. (The key-mismatch guard exists for the separate
file-based backup/restore path, where a backup may have been taken under a
different key -- there the restore refuses with a clear error until the key
matches.)

---

## Reversibility

The source database is untouched throughout. To roll back, point the env vars at
the original backend and restart. You can run the migration in the other direction
at any time using the same panel.
