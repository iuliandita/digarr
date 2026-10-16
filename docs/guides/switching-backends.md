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

A cancellation request keeps the pipeline marked running until in-flight work and awaited bookkeeping settle; wait for that settlement, not merely `cancelled: true`. A run already finalizing can decline cancellation with `Pipeline finishing`. Saved recommendations and remote additions remain. Hung operations keep the pipeline busy; do not bypass that state to start a migration. v1.19.0 instead can clear the indicator after 15 seconds while storage or target additions continue ([#790](https://github.com/iuliandita/digarr/issues/790)). On every version, also wait for other running jobs and writers; a settled pipeline alone does not establish that the whole application is idle.

Pause schedules and prevent other users from writing until cutover is complete. The built-in lock ends when the copy finishes, before you inspect the report or restart.

Any later source writes are absent from the target. If writes resume, repeat the copy before switching. This is a point-in-time copy, not continuous replication.

---

## Database identifier upgrades

Before upgrading an installation that uses reserved characters or literal percent escapes in its database settings, stop writes and take a consistent native backup of the database it actually uses. Retain the exact encryption key, previous image and configuration. Check `current_database()` and `current_user` directly on that server, then confirm the intended names with the new configuration before allowing application writes.

The correction can select a different database if the old version used an accidentally decoded, escaped or fallback name. It does not rename databases or move data. If the populated database has the old unintended name, deliberately configure that exact name or perform a separately verified backend copy. Do not proceed merely because startup creates an empty schema successfully.

No schema migration is added by this correction. For rollback, stop writes, restore the previous image and exact previous settings, and reconnect to the verified original database. If data was copied or changed after cutover, use its consistent native backup; changing the image does not merge databases. Keep URI-unreserved identifiers other than `.` or `..` when operating the old parser.

## Step-by-step

### 1. Open the panel

Go to **Settings > Administration > Migrate Database Backend** (directly below
the Backup & Restore section). The panel shows the currently active backend.

### 2. Choose a target

Use a fresh, dedicated target database or directory. Take a complete, consistent backup before selecting any existing destination, and keep the matching encryption key. Any row in a table the copy replaces requires explicit `overwrite=true`, including settings, artists and caches when no users exist. The guard checks existing tables before schema migrations and checks again under table locks inside the copy transaction before clearing data. Failed inspections abort instead of assuming the destination is empty. v1.19.0 checks only users and can replace other data without overwrite consent ([#775](https://github.com/iuliandita/digarr/issues/775)). A successful connection test does not establish that the destination is empty.

Select one:

| Target | What to fill in |
|--------|----------------|
| PostgreSQL | Full connection string (DSN): `postgresql://user:pass@host:5432/dbname` |
| PGlite | Absolute path to the data directory on the container filesystem, e.g. `/app/data-new` |

For PostgreSQL, percent-encode the username, password, and database-name components of the DSN when needed, not the whole URL: `pass#word` becomes `pass%23word`, and a literal `%` becomes `%25`. An explicit `DATABASE_URL` takes precedence over separate settings. Keep the original, unencoded password in `POSTGRES_PASSWORD` or direct `DB_PASS`. `DB_PASS_FILE` trims surrounding whitespace, so password files must not contain intentional leading or trailing whitespace. Enter real credentials in the protected configuration or GUI, not command-line arguments.

Supply raw `DB_USER`, `DB_PASS`, and `DB_NAME` when using separate settings; Digarr encodes each component once. Do not pre-encode those values. Application startup and backend-copy targets also preserve reserved database-name characters and dot segments in encoded DSNs. External Drizzle Kit commands use their own connection-string parser and are outside this correction. v1.19.0 encodes only `DB_PASS` and can still misread an encoded database name ([#773](https://github.com/iuliandita/digarr/issues/773), [#834](https://github.com/iuliandita/digarr/issues/834)).

For PGlite, the path must be inside the configured data root. The test step
checks this without creating any files.

The data root defaults to the parent directory of the currently active PGlite
data directory (for Docker deployments that is `/app`, since the default
`DB_PATH` is `/app/data`). To allow migration targets elsewhere - for example
a second mounted volume - set `DIGARR_MIGRATE_DATA_ROOT` to that directory
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
2. Refuses populated copy-managed tables unless overwrite is explicit, then runs schema migrations on the target (creates missing tables).
3. Opens a consistent `REPEATABLE READ READ ONLY` transaction on the source.
4. Unless overwrite is explicit, locks the copy-managed target tables against
   writers and checks emptiness again. Copies tables in foreign-key order inside
   that same transaction, using bounded insert chunks.
5. Verifies each table by row count and SHA-256 content hash before loading the
   next table.
6. Releases the maintenance lock.

Stop other applications writing to the destination as well. The locked check waits for existing writers; if their committed rows make a table nonempty, the copy refuses with `409 target_not_empty` before clearing it. Target writers can resume after the transaction ends, so keep them stopped through report inspection and cutover.

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

When switching backends, follow the complete list below, including file-backed settings:

- **Switching to PostgreSQL**: set `DATABASE_URL` to the connection string you
  entered (e.g. `postgresql://digarr:pass@db-host:5432/digarr`), with username,
  password, and database-name components percent-encoded as needed. Alternatively,
  set `DB_HOST`, `DB_USER`, `DB_NAME`, and `DB_PASS` individually with raw usernames, database names and passwords, as described above. For TLS,
  `DB_SSL_MODE` accepts `disable`, `require`, or `no-verify`. Note that
  Digarr's `require` performs full certificate verification - stricter than
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

The registry includes users, artists, recommendations, targets, saved connections, settings, preferences, jobs, playlists and their remote export bindings, artist/album blocks, and library state. It does not preserve unfinished provider authorization transactions.

---

## Encryption

Migration runs in-process with the same `DIGARR_ENCRYPTION_KEY`. Encrypted
column values transfer verbatim and remain decryptable on the new backend because
the key has not changed.

Both backends use the running process's encryption key during the copy. Keep that same key when restarting on the new backend. The key-mismatch guard belongs to JSON restore: it refuses a backup taken under a different key unless you force it and re-enter affected credentials.

---

## Reversibility

The destination-guard correction adds no schema migration. Rolling back to v1.19.0 restores its users-only check; use a fresh target or take and verify its complete backup before authorizing an overwrite. A refused guarded copy does not require restoring rows, but target schema migrations may already have run before the final check.

Migration copies data once; it does not keep the two backends synchronized. The original backend does not receive writes made after cutover. Pointing environment settings back at it and restarting resumes the old state, omitting later accounts, preferences, approvals, and other changes. Direct switch-back is appropriate only before writes begin on the new backend, or when abandoning those newer changes is intentional.

To preserve changes made after cutover, stop writers and take complete backups of both databases, retaining the encryption key separately. Plan and verify a reverse migration or recovery before switching the application back. The same migration panel supports the reverse direction, but replacing a nonempty original database requires an explicit overwrite decision after backing it up. Verify the copied data and the [recovery boundaries](#backup-boundaries-and-recovery); do not assume a change of connection settings transfers newer data.

## Backup boundaries and recovery

For v1.19.0-to-v2.0.0 upgrades, follow the [combined upgrade procedure](../OPERATIONS.md#upgrading-from-v1190-to-v200) before starting the new image. Migrations 0052, 0053, and 0054 add digest positions, playlist export bindings, and exact OIDC issuer/subject pairs. Verify a native backup by restoring it separately before using the one-upgrade automatic-backup override; re-enable automatic backups afterward.

New application JSON exports use a consistent snapshot and include persistent application state and its artist dependencies by default: recommendations, blocks, playlists, library snapshots and overrides, recording cache, and slskd jobs. `includeCaches=true` adds optional artist metadata, not required recovery dependencies. Keep the matching encryption key separately. Sessions, pending authorizations, rate limits, and migration history are deliberately excluded, so JSON recovery is not a database-schema rollback.

Saved remote export bindings are included in new JSON exports and backend copies. Restoring older knowledge cannot undo external playlist writes or recover IDs created afterward; inspect each destination before an explicit binding reset, which may create another copy. Older JSON files without bindings remain readable but cannot clear populated omitted bindings through parent replacement; that returns `422 partial_backup_conflict` even with `force=true`.

Migration 0053 in v2.0.0 adds the binding table. An existing schema without it cannot satisfy the v2.0.0 pre-migration snapshot. v2.0.1 and later back it up without an override; for v2.0.0 as released, use the verified native-backup override procedure below, retain the key and previous image, then re-enable automatic backup. Roll back by restoring the matching native backup into a separate database with its previous image; older images do not maintain bindings and can accumulate remote copies again. Migration itself does not contact remote services.

Migration 0054 in v2.0.0 binds OIDC accounts to exact issuer/subject pairs. Backend copies and new JSON exports preserve both; older JSON restores retain the subject with a null issuer and require [verified operator recovery](../AUTHENTICATION.md#recovering-legacy-oidc-bindings). Migration never infers the historical issuer. The old schema's missing column stops automatic snapshots; use the verified native-backup override below only for this understood upgrade. Retain the key and previous image. For rollback, restore the previous image's matching native backup into a separate database; a subject-only image cannot safely read migrated identities.

Migration 0055 assigns recommendations without an owner to the first admin. It changes data only, so backend copies and JSON exports carry the assigned owner. Restoring an older JSON backup applies the same rule to its ownerless rows inside the restore transaction, using the restored users. For rollback, restore the previous image's matching native backup into a separate database.

Legacy v1.19.0 JSON files remain partial, including those named `-full`. Restore checks dependencies before replacing tables. If clearing included parents would alter populated omitted tables, or artist references cannot resolve, it returns `422 partial_backup_conflict` without changing the destination; `force=true` only handles encryption mismatch and cannot bypass this check. Use a complete new export, or a fresh compatible database when the legacy file has the required dependencies. Restore does not invent missing artists or merge account identities. Back up the destination before any restore.

Automatic pre-migration snapshots include optional metadata and must succeed before migrations run. v2.0.1 and later read only the tables and columns the old schema already has and list the omitted ones in the file, so a missing column no longer blocks the upgrade; v2.0.0 itself does not, see the override below. Any other snapshot failure stops the upgrade before migrations: take and verify the native consistent database backup below first, and treat `DIGARR_AUTO_BACKUP=false` as a one-upgrade override for a failure you understand. No database migration is introduced by this backup change. To roll back application behavior, keep the previous image; after any later schema migration, restore that image's matching native backup into a separate database instead of feeding it a newer schema.

For complete recovery, retain a database backup and the matching encryption key separately:

- PostgreSQL server (bundled container or user-managed external server): stop app writers, keep PostgreSQL running, and take a `pg_dump -Fc` backup. Check it with `pg_restore --list` and test restoring into a separate database before relying on it.
- Embedded PGlite: stop every process using its data directory, then archive or snapshot the entire persistent data volume. Never copy a live directory. Check the archive and test it with a separate data directory and a compatible image.

The [Docker backup procedure](../../deploy/docker/README.md#back-up-and-update) includes complete Compose commands for both database-backup methods. Protect backups as credentials, copy them off the host, and preserve the original database until the recovered instance is verified.

## Digest delivery migration

Migration 0052 in v2.0.0 adds nullable `settings.digest_delivery_positions`. Existing databases lack this column before the migration, so the v2.0.0 automatic snapshot fails closed before DDL; v2.0.1 and later back it up without an override. For v2.0.0 only, stop app writers, take and verify the native consistent database backup described above, and retain the exact encryption key and previous image. Then explicitly set `DIGARR_AUTO_BACKUP=false` for the upgrade and re-enable it after startup succeeds. Do not bypass an unexplained backup failure. Fresh databases need no override.

Current channel IDs inherit the legacy shared timestamp once, including when the digest schedule is disabled. New IDs use the current cadence; old windows already skipped by the legacy bookmark cannot be recovered. Application backups and backend copies preserve the new map. An older application backup without the field leaves it uninitialized and uses its legacy timestamp at startup or on the next live tick after restore.

For rollback, restore the previous image's verified native backup into a separate database and use that image with its matching key. Do not feed a migrated database or newer JSON backup to an older image. Verify recovery before replacing the original database; delivery after the backup may repeat, because remote sends are not rolled back.
