# Switching the Database Backend

Digarr ships with an embedded PGlite database (no separate PostgreSQL required)
and supports a PostgreSQL server via `DATABASE_URL` or the `DB_HOST` / `DB_USER`
/ `DB_NAME` / `DB_PASS` variables. The "Migrate Database Backend" panel in
Settings lets admins copy the application restore registry between the two backends in one
operation, without touching or modifying the source.

## When to use this

- **Managed or larger database**: embedded PGlite is single-writer and shares
  the app process and its memory. When your library grows large or you want the
  database managed independently, switch to a PostgreSQL server. Keep the app
  at one replica: pipeline coordination, schedulers, rate limits, and migration
  locks are process-local, so PostgreSQL alone does not make horizontal scaling
  safe.
- **Rolling back**: if you want to return to embedded PGlite after running on
  a PostgreSQL server, the same tool runs in reverse.

The migration tool is for backend changes only. For selected application-data exports, use Backup & Restore (Settings > Administration). For complete disaster recovery, take a consistent database backup as described below.

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

Pause schedules and prevent other users from writing until cutover is complete. The built-in lock ends when the copy finishes, before you inspect the report or restart.

Any later source writes are absent from the target. If writes resume, repeat the copy before switching. This is a point-in-time copy, not continuous replication.

---

## Step-by-step

### 1. Open the panel

Go to **Settings > Administration > Migrate Database Backend** (directly below
the Backup & Restore section). The panel shows the currently active backend.

### 2. Choose a target

Use a fresh, dedicated target database or directory. Take a complete backup before selecting any existing destination. The nonempty-target guard checks only for users: a target containing other application data but no users can be cleared and replaced even with `overwrite=false` ([#775](https://github.com/iuliandita/digarr/issues/775)). A successful connection test does not establish that the destination is empty.

Select one:

| Target | What to fill in |
|--------|----------------|
| PostgreSQL | Full connection string (DSN): `postgresql://user:pass@host:5432/dbname` |
| PGlite | Absolute path to the data directory on the container filesystem, e.g. `/app/data-new` |

For PostgreSQL, percent-encode the username, password, and database-name components of the DSN when needed, not the whole URL: `pass#word` becomes `pass%23word`, and a literal `%` becomes `%25`. Digarr passes an explicit `DATABASE_URL` unchanged. Keep the original, unencoded password in `POSTGRES_PASSWORD` or direct `DB_PASS`. `DB_PASS_FILE` trims surrounding whitespace, so password files must not contain intentional leading or trailing whitespace. Enter real credentials in the protected configuration or GUI, not command-line arguments.

The separate `DB_*` builder encodes only `DB_PASS`. Use only URI-unreserved characters (`A-Z`, `a-z`, `0-9`, `-`, `.`, `_`, `~`) in `DB_USER` and `DB_NAME`; other usernames or database names require a complete `DATABASE_URL` with percent-encoded components ([#773](https://github.com/iuliandita/digarr/issues/773)).

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
2. Runs schema migrations on the target (creates all tables).
3. Opens a consistent `REPEATABLE READ READ ONLY` transaction on the source.
4. Copies tables in foreign-key order inside one target transaction, using
   bounded insert chunks.
5. Verifies each table by row count and SHA-256 content hash before loading the
   next table.
6. Releases the maintenance lock.

The migration does not modify the source database. If a copy write fails, the target
copy transaction rolls back. Target schema migrations and, during an overwrite,
the intentional session/rate-limit clear remain outside that transaction. A
verification mismatch keeps the copied target for inspection but returns a
failed report, so do not switch the application to it. Retry after fixing the
underlying problem.

The migration does not build whole-database source and target snapshots in
application memory. Its working set follows the largest table being copied and
verified, rather than the size of the full database.

Progress is shown inline. On a large library the copy may take a minute or two.

### 5. Read the report

On success, the panel shows every migrated table and its row count. Its excluded-table list names sessions and rate-limit buckets; unfinished OAuth transactions are also outside the copy registry (see below). Count and same-count content mismatches
appear in the failed report with details.

### 6. Set the env var and restart

The panel shows the exact environment variable(s) to set for the new backend:

- **Switching to PostgreSQL**: set `DATABASE_URL` to the connection string you
  entered (e.g. `postgresql://digarr:pass@db-host:5432/digarr`), with username,
  password, and database-name components percent-encoded as needed. Alternatively,
  set `DB_HOST`, `DB_USER`, `DB_NAME`, and `DB_PASS` individually with URI-unreserved usernames/database names and the original, unencoded password, as described above. For TLS,
  `DB_SSL_MODE` accepts `disable`, `require`, or `no-verify`. Note that
  Digarr's `require` performs full certificate verification -- stricter than
  libpq's `require`, which encrypts without verifying. Use `no-verify` for
  self-signed certificates.
- **Switching to PGlite**: unset `DATABASE_URL`, `DATABASE_URL_FILE`, and `DB_HOST`, then set `DB_PATH`
  to the directory path you entered (e.g. `DB_PATH=/app/data-new`). Mount persistent, writable storage at that path before copying; the bundled Compose and Helm deployments configure a read-only root filesystem.

Update your `docker-compose.yml`, Helm values, or container template, then
restart Digarr. A readable `DATABASE_URL_FILE` can select PostgreSQL even when `DATABASE_URL` is empty. The PGlite Compose file explicitly clears `DATABASE_URL` and `DB_HOST`; remove `DATABASE_URL_FILE` from `.env` yourself. Setting the direct variables only in `.env` will not switch that stack to PostgreSQL. Change the service environment or use an appropriate Compose override. Preserve the existing data and backup volumes when changing Compose files.

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
  "gitSha": "...",
  "channel": "stable",
  "dbBackend": "postgres"
}
```

Confirm it shows `"postgres"` or `"pglite"` as expected.

---

## What is not copied

The copy follows the application restore registry, not every database table. These ephemeral records are excluded:

| Excluded | Effect |
|----------|--------|
| `sessions` | All users are logged out and must log in again after the restart. |
| Rate-limit counters | Login and register rate limits reset. |
| `oauth_pending_auths` | Unfinished Spotify, Deezer, and TIDAL connect attempts must be restarted. |

The registry includes users, artists, recommendations, targets, saved connections, settings, preferences, jobs, playlists, artist/album blocks, and library state. It does not preserve unfinished provider authorization transactions.

---

## Encryption

Migration runs in-process with the same `DIGARR_ENCRYPTION_KEY`. Encrypted
column values transfer verbatim and remain decryptable on the new backend because
the key has not changed.

Both backends use the running process's encryption key during the copy. Keep that same key when restarting on the new backend. The key-mismatch guard belongs to JSON restore: it refuses a backup taken under a different key unless you force it and re-enter affected credentials.

---

## Reversibility

The source database is untouched throughout. To roll back, point the env vars at
the original backend and restart. You can run the migration in the other direction
at any time using the same panel.

## Backup boundaries and recovery

In v1.19.0, the application JSON export is a partial export, including when its filename ends in `-full`. The default and startup auto-backups omit the artist rows referenced by recommendations and artist blocks. Use `POST /api/v1/admin/backup?includeCaches=true` for a consistent artist-inclusive export before restoring those rows into an empty database. Restore does not fetch missing artists.

Restore clears included users before inserting the backup rows. Foreign-key cascades also delete omitted user-owned rows, including album blocks and library state, so omission does not preserve destination data ([#757](https://github.com/iuliandita/digarr/issues/757)). Take a complete backup of the destination first and prefer a fresh database for JSON restore.

Even `includeCaches=true` omits album blocks, library snapshots and reconciliation overrides, library health state, recording cache, and slskd job state. There is no public `full=true` export option. The in-app backend migration copies the broader restore registry and is separate from this JSON export. Startup backup failures do not stop migrations, so verify a usable backup yourself before updating.

For complete recovery, retain a database backup and the matching encryption key separately:

- PostgreSQL server (bundled container or user-managed external server): stop app writers, keep PostgreSQL running, and take a `pg_dump -Fc` backup. Check it with `pg_restore --list` and test restoring into a separate database before relying on it.
- Embedded PGlite: stop every process using its data directory, then archive or snapshot the entire persistent data volume. Never copy a live directory. Check the archive and test it with a separate data directory and a compatible image.

The [Docker backup procedure](../../deploy/docker/README.md#back-up-and-update) includes complete Compose commands for both database-backup methods. Protect backups as credentials, copy them off the host, and preserve the original database until the recovered instance is verified.
