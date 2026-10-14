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

Cancellation does not establish that a scan has stopped writing. A late cancellation can leave storage and automatic target additions running after the running indicator clears ([#790](https://github.com/iuliandita/digarr/issues/790)). Wait for the actual work to finish; do not start migration while its completion is uncertain.

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

The panel suggests environment settings, but its PGlite hint omits `DATABASE_URL_FILE` ([#781](https://github.com/iuliandita/digarr/issues/781)); follow the complete list below for the new backend:

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

Migration copies data once; it does not keep the two backends synchronized. The original backend does not receive writes made after cutover. Pointing environment settings back at it and restarting resumes the old state, omitting later accounts, preferences, approvals, and other changes. Direct switch-back is appropriate only before writes begin on the new backend, or when abandoning those newer changes is intentional.

To preserve changes made after cutover, stop writers and take complete backups of both databases, retaining the encryption key separately. Plan and verify a reverse migration or recovery before switching the application back. The same migration panel supports the reverse direction, but replacing a nonempty original database requires an explicit overwrite decision after backing it up. Verify the copied data and the [recovery boundaries](#backup-boundaries-and-recovery); do not assume a change of connection settings transfers newer data.

## Backup boundaries and recovery

New application JSON exports use a consistent snapshot and include persistent application state and its artist dependencies by default: recommendations, blocks, playlists, library snapshots and overrides, recording cache, and slskd jobs. `includeCaches=true` adds optional artist metadata, not required recovery dependencies. Keep the matching encryption key separately. Sessions, pending authorizations, rate limits, and migration history are deliberately excluded, so JSON recovery is not a database-schema rollback.

Legacy v1.19.0 JSON files remain partial, including those named `-full`. Restore checks dependencies before replacing tables. If clearing included parents would alter populated omitted tables, or artist references cannot resolve, it returns `422 partial_backup_conflict` without changing the destination; `force=true` only handles encryption mismatch and cannot bypass this check. Use a complete new export, or a fresh compatible database when the legacy file has the required dependencies. Restore does not invent missing artists or merge account identities. Back up the destination before any restore.

Automatic pre-migration snapshots include optional metadata and must succeed before migrations run. A current-schema snapshot cannot read every older schema; missing tables or columns now stop the upgrade safely. To upgrade such a schema, first take and verify the native consistent database backup below, retain the matching key and previous image, then explicitly set `DIGARR_AUTO_BACKUP=false` for the upgrade. Re-enable it afterward. No database migration is introduced by this backup change. To roll back application behavior, keep the previous image; after any later schema migration, restore that image's matching native backup into a separate database instead of feeding it a newer schema.

For complete recovery, retain a database backup and the matching encryption key separately:

- PostgreSQL server (bundled container or user-managed external server): stop app writers, keep PostgreSQL running, and take a `pg_dump -Fc` backup. Check it with `pg_restore --list` and test restoring into a separate database before relying on it.
- Embedded PGlite: stop every process using its data directory, then archive or snapshot the entire persistent data volume. Never copy a live directory. Check the archive and test it with a separate data directory and a compatible image.

The [Docker backup procedure](../../deploy/docker/README.md#back-up-and-update) includes complete Compose commands for both database-backup methods. Protect backups as credentials, copy them off the host, and preserve the original database until the recovered instance is verified.

## Digest delivery migration

The digest fix adds nullable `settings.digest_delivery_positions`. Existing databases lack this column before the migration, so the current-schema automatic snapshot fails closed before DDL. For this upgrade, stop app writers, take and verify the native consistent database backup described above, and retain the exact encryption key and previous image. Then explicitly set `DIGARR_AUTO_BACKUP=false` for the upgrade and re-enable it after startup succeeds. Do not bypass an unexplained backup failure. Fresh databases need no override.

Current channel IDs inherit the legacy shared timestamp once, including when the digest schedule is disabled. New IDs use the current cadence; old windows already skipped by the legacy bookmark cannot be recovered. Application backups and backend copies preserve the new map. An older application backup without the field leaves it uninitialized and uses its legacy timestamp at startup or on the next live tick after restore.

For rollback, restore the previous image's verified native backup into a separate database and use that image with its matching key. Do not feed a migrated database or newer JSON backup to an older image. Verify recovery before replacing the original database; delivery after the backup may repeat, because remote sends are not rolled back.
