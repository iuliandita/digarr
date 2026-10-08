# Docker deployment

This directory contains the Docker Compose stacks for running Digarr in
production or local development. Use Docker Compose 2.24.0 or newer: the stacks use optional `env_file` entries. Check with `docker compose version`. On an older installation, upgrade Compose or replace the optional entry with `env_file: [".env"]` and keep a protected `.env` file present.

For a new single-host installation, PGlite is the simplest starting point. Choose PostgreSQL when you need a separate database service and its standard backup and administration tools. Two bases are provided:

- `docker-compose.yml` -- the default. Runs the app plus a bundled
  PostgreSQL container, sharing a single password secret. The database lives in
  the `pgdata` volume and persists across image re-pulls.
- `docker-compose.pglite.yml` -- single container with the embedded PGlite
  database (real PostgreSQL compiled to Wasm, in-process). No database sidecar,
  no database-password secret. Data lives in the `data` volume.

## Production

The Compose stacks publish port 3000 on all host interfaces. Restrict access until the intended admin account exists and you have verified it, including when `DIGARR_INITIAL_USERNAME` and `DIGARR_INITIAL_PASSWORD` are configured. The HTTP listener opens before environment-based bootstrap finishes ([#785](https://github.com/iuliandita/digarr/issues/785)). For access only from this computer, change the published port to `127.0.0.1:3000:3000`.

Before starting either stack, copy `.env.example` to `.env`. Set `ALLOWED_ORIGIN` to the exact browser URL, with no trailing slash, and save a generated `DIGARR_ENCRYPTION_KEY` there. Use the [protected key-generation procedure](../../docs/AUTHENTICATION.md#generate-a-new-encryption-key), then copy the value into `.env` with a trusted editor. Restrict access to this file and keep a separate backup of the key. For deliberate plain-HTTP access, also set `DIGARR_ALLOW_INSECURE_COOKIES=true`; HTTPS deployments should leave it false. See [authentication](../../docs/AUTHENTICATION.md#public-origin-and-reverse-proxies).

### Embedded PGlite (single container)

```
cd deploy/docker
docker compose -f docker-compose.pglite.yml up -d
```

No secret to create and no separate database container. The app stores its
data in the `data` volume; `backups` holds the pre-migration auto-backups.

### Bundled PostgreSQL (default)

```
cd deploy/docker
mkdir -p secrets
chmod 700 secrets
# Set ONE database password -- both Postgres and the app read this single file.
(umask 077 && printf '%s\n' 'change-this-password' > secrets/postgres_password)
# Digarr runs as UID 1000 and must be able to read this protected file.
sudo chown 1000:1000 secrets/postgres_password
# Use the .env configured above; do not overwrite it.
docker compose up -d
```

Services run on an isolated internal `backend` network; only `app` is exposed
on the host via `frontend`. The default image is the alpine variant; pull a
specific tag or swap in the `-debian` variant by editing `docker-compose.yml`.

When a reverse proxy or TLS terminator publishes Digarr on a different origin,
set `ALLOWED_ORIGIN` in `.env` to that exact external `https://` origin. Browser
session cookies and CSRF checks use its scheme and host. Production cookies stay
`Secure` even though the proxy reaches the container over HTTP, so an HTTPS
public origin needs no further flag. See
[Authentication](../../docs/AUTHENTICATION.md#public-origin-and-reverse-proxies).

An HTTPS public origin is strongly preferred. If you intentionally open the
production container directly over plain HTTP, use the `.env` configured above and
set `DIGARR_ALLOW_INSECURE_COOKIES=true` with a matching `http://`
`ALLOWED_ORIGIN`; otherwise the browser rejects the `Secure` session cookie.
Direct HTTP exposes the session cookie to network interception.

## Back up and update

Application JSON exports are partial. For complete recovery, back up the database consistently and keep the matching encryption key separately. See [backup boundaries](../../docs/guides/switching-backends.md#backup-boundaries-and-recovery). Keep the same Compose project directory and volume names when recreating services; do not use `docker compose down -v` unless you intend to delete the data.

### Compose database backups

Run these commands from your existing Compose project directory containing `.env` and the downloaded Compose files. Source-checkout users first run `cd deploy/docker` from the repository root. Retain every `-f` override and any project-name option used for your installation in every command below so the backup uses the existing database and volumes.

Stop every app instance and any other database writers for the backup. The commands below stop the bundled `app` service and leave it stopped on failure. Each block runs in a subshell, protects new files, and refuses to overwrite an existing backup.

For the bundled PostgreSQL stack, leave the `postgres` service running:

```sh
(
  set -eu
  set -C
  umask 077
  backup_dir="$HOME/digarr-backups"
  install -d -m 700 "$backup_dir"
  backup_file="$backup_dir/postgres-$(date -u +%Y%m%dT%H%M%SZ).dump"
  docker compose -f docker-compose.yml stop app
  docker compose -f docker-compose.yml exec -T postgres \
    sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    > "$backup_file"
  test -s "$backup_file"
  docker compose -f docker-compose.yml exec -T postgres \
    pg_restore --list < "$backup_file" > /dev/null
  printf 'Verified backup listing: %s\n' "$backup_file"
)
```

For embedded PGlite, the one-off container mounts the same data volume without starting the app or its dependencies:

```sh
(
  set -eu
  set -C
  umask 077
  backup_dir="$HOME/digarr-backups"
  install -d -m 700 "$backup_dir"
  backup_file="$backup_dir/pglite-$(date -u +%Y%m%dT%H%M%SZ).tar"
  docker compose -f docker-compose.pglite.yml stop app
  docker compose -f docker-compose.pglite.yml run -T --rm --no-deps \
    --entrypoint tar app -C /app/data -cf - . > "$backup_file"
  test -s "$backup_file"
  tar -tf "$backup_file"
  printf 'Verified backup listing: %s\n' "$backup_file"
)
```

Check that the PGlite listing contains your database files. A successful listing checks archive readability, not application recovery. Copy the backup off the host, along with separate protected recovery material containing the exact encryption-key bytes, Compose configuration, `.env`, and database credentials. Test a restore into a separate database or data volume with a compatible image and the matching key before relying on it. Never point a recovery test at the live database or volume.

Only after these checks succeed, restart the existing app with the matching command:

```sh
# Bundled PostgreSQL
docker compose -f docker-compose.yml start app
# Embedded PGlite
docker compose -f docker-compose.pglite.yml start app
```

Run only the command for your stack. If a backup check fails, keep the app stopped while resolving it; do not proceed with an update. Once recovery is verified, pull and recreate only the app, retaining your existing overrides:

```sh
# Bundled PostgreSQL
docker compose -f docker-compose.yml pull app
docker compose -f docker-compose.yml up -d --no-deps app
# Embedded PGlite
docker compose -f docker-compose.pglite.yml pull app
docker compose -f docker-compose.pglite.yml up -d --no-deps app
```

Run only the pair for your stack. Check `/health`, confirm the intended database backend, and sign in. Keep the previous image and backup until the upgrade is verified. PostgreSQL server upgrades need their own version-compatible procedure; these commands update only Digarr. An older app image may require restoring its compatible database backup after migrations.

### Restore a complete database backup

These steps use the existing Compose project and retain the old database or volume. Keep all app instances and other writers stopped through recovery. Use an image compatible with the backup and the exact encryption-key bytes saved with it. Before starting a restored app, decide whether it should resume scheduled work and connected-service writes; a recovery test should be isolated from those services.

For bundled PostgreSQL, select your custom-format dump and restore into a new database. `createdb` fails if `digarr_recovery` already exists; choose another unused name instead of dropping existing data. Use the same PostgreSQL major version as the backup source, or follow PostgreSQL's upgrade procedure separately.

```sh
(
  set -eu
  backup_file="$HOME/digarr-backups/postgres-REPLACE_WITH_TIMESTAMP.dump"
  test -s "$backup_file"
  docker compose -f docker-compose.yml stop app
  docker compose -f docker-compose.yml exec -T postgres \
    sh -c 'createdb -U "$POSTGRES_USER" digarr_recovery'
  docker compose -f docker-compose.yml exec -T postgres \
    sh -c 'pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d digarr_recovery' \
    < "$backup_file"
  docker compose -f docker-compose.yml exec -T postgres \
    sh -c 'psql -U "$POSTGRES_USER" -d digarr_recovery -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM users"'
)
```

If any step fails, leave the app stopped and preserve both databases. To use the restored database, set `DB_NAME=digarr_recovery` in the project's `.env`, retain the matching encryption key, and run `docker compose -f docker-compose.yml up -d postgres app`. Recreating both services updates their database-name environment; the old database remains in the same PostgreSQL volume. Do not set a conflicting `DATABASE_URL` in `.env`.

For PGlite, select the archive and extract it into a new named volume. This uses the existing app image only as an archive tool, with root access limited to preparing the new volume; the app still runs as UID 1000. Only restore archives you trust.

```sh
(
  set -eu
  backup_file="$HOME/digarr-backups/pglite-REPLACE_WITH_TIMESTAMP.tar"
  test -s "$backup_file"
  docker compose -f docker-compose.pglite.yml stop app
  digarr_image=$(docker compose -f docker-compose.pglite.yml images -q app)
  test -n "$digarr_image"
  if docker volume inspect digarr-recovery-data > /dev/null 2>&1; then
    printf '%s\n' 'digarr-recovery-data already exists; choose a new volume name.' >&2
    exit 1
  fi
  docker volume create digarr-recovery-data
  docker run --rm -i --user 0:0 --network none \
    -v digarr-recovery-data:/app/data --entrypoint sh "$digarr_image" \
    -c 'tar -C /app/data -xf - && chown -R 1000:1000 /app/data' < "$backup_file"
)
```

If extraction fails, keep the app stopped and use another fresh volume for the next attempt. Save this volume override as `recovery.override.yml`:

```yaml
services:
  app:
    volumes:
      - digarr-recovery-data:/app/data
volumes:
  digarr-recovery-data:
    external: true
```

Keep the matching key in `.env`, ensure no PostgreSQL connection variables select another backend, and start only the restored app:

```sh
docker compose -f docker-compose.pglite.yml -f recovery.override.yml up -d --no-deps app
```

Retain this override in every later Compose command, including backups and updates. It replaces only the `/app/data` mount; the original volume is preserved. For the named-volume `docker run` installation below, use the same extraction procedure with the saved image ID and archive, then recreate the app using `-v digarr-recovery-data:/app/data` and the original protected `digarr.env`.

For either backend, check `/health`, sign in, and confirm expected users, recommendations, and settings before reopening access. Retain the original backup and database until recovery is verified. The dump/restore and PGlite archive mechanics were checked with synthetic data; this is not a claim of live provider, NAS, or full application recovery validation.

### Named-volume `docker run` backup

For the README's named-volume `docker run` example, stop the app before archiving its PGlite files. Run these commands from the directory containing `digarr.env`:

```sh
(
set -eu
set -C
umask 077
install -d -m 700 "$HOME/digarr-backups"
backup_file="$HOME/digarr-backups/docker-run-pglite-$(date -u +%Y%m%dT%H%M%SZ).tar"
digarr_image=$(docker inspect --format '{{.Image}}' digarr)
docker stop digarr
docker run --rm --volumes-from digarr:ro --entrypoint tar "$digarr_image" \
  -C /app/data -cf - . > "$backup_file"
test -s "$backup_file"
tar -tf "$backup_file"
printf '%s\n' "$digarr_image" > "$backup_file.image-id"
printf 'Verified backup listing: %s\nImage ID saved in: %s.image-id\n' "$backup_file" "$backup_file"
)
```

Check that the archive command succeeds and the listing contains your database files. If it fails, keep the app stopped while resolving the backup failure before updating. Copy the archive, its `.image-id` sidecar, and a separate protected copy of `digarr.env` off the host. The image ID identifies the local image used for recovery; retain that image locally or record an available compatible release tag too. Test recovery into a separate volume before relying on the backup.

Then recreate the container with the same volumes and key:

```sh
docker pull docker.io/iuliandita/digarr:latest
docker rm digarr
docker run -d --name digarr --restart unless-stopped -p 127.0.0.1:3000:3000 \
  --env-file ./digarr.env \
  -e ALLOWED_ORIGIN=http://localhost:3000 \
  -e DIGARR_ALLOW_INSECURE_COOKIES=true \
  -v digarr-data:/app/data -v digarr-backups:/app/backups \
  docker.io/iuliandita/digarr:latest
docker logs --tail 100 digarr
```

`docker rm` without `-v` preserves these named volumes. This command matches the README example; retain your own ports, origin, environment, mounts, and restart policy if you changed them. Check `/health` and sign in after startup. Keep the previous image ID until the upgrade is verified. An older image may be incompatible with a migrated database; [recovery](../../docs/guides/switching-backends.md#backup-boundaries-and-recovery) can require restoring a compatible database backup rather than changing the image tag.

## Development with compose

`docker-compose.dev.yml` is a base-agnostic override that only adds the app
build context, so it layers onto either base:

```
# Postgres base
docker compose \
  -f deploy/docker/docker-compose.yml \
  -f deploy/docker/docker-compose.dev.yml up

# PGlite base
docker compose \
  -f deploy/docker/docker-compose.pglite.yml \
  -f deploy/docker/docker-compose.dev.yml up
```

To reach the Postgres base's database from the host, add
`-f deploy/docker/docker-compose.pgport.yml`, which republishes host port 5432
only with the PostgreSQL base. Do not layer this override onto PGlite: it declares a `postgres` service that the PGlite base does not define.
Everything else (secrets, networks, healthchecks, resource limits) comes from
the chosen base file.

## Secrets

The PGlite base needs no database-password secret. Both backends need `DIGARR_ENCRYPTION_KEY` to encrypt saved service credentials. The rest of this section applies only to the
Postgres base (`docker-compose.yml`).

The Postgres base compose file uses the `_FILE` env convention with a single secret.
Postgres reads its password from `POSTGRES_PASSWORD_FILE`, and the app reads the
same file via `DB_PASS_FILE`, then assembles `DATABASE_URL` from `DB_HOST`,
`DB_USER`, `DB_NAME`, and that password. The password therefore lives in exactly
one configuration file -- `secrets/postgres_password`. PostgreSQL reads it when initializing the database; changing the file later does not update the initialized role password. Coordinate password rotation with PostgreSQL before restarting the app. Digarr trims surrounding whitespace from `DB_PASS_FILE`, so password files must not contain intentional leading or trailing whitespace. Create that file before starting the stack; see
`secrets/postgres_password.example` for the format (one line, the password
only). File-backed Compose secrets retain host ownership and mode: the app runs as UID 1000 and must be able to read this file. If the host user differs, use `sudo chown 1000:1000 secrets/postgres_password` and keep mode `0600`; the PostgreSQL entrypoint reads it as root.

An unreadable `_FILE` secret currently falls back to an unset value without reporting the file error ([#763](https://github.com/iuliandita/digarr/issues/763)). Verify the mount and UID 1000 read permission before startup. In the bundled PostgreSQL stack, an unreadable `DB_PASS_FILE` leaves PostgreSQL selected but can cause password authentication failure. An unreadable `DATABASE_URL_FILE`, without a complete `DB_HOST`/`DB_USER`/`DB_NAME` alternative, can select an empty PGlite database. Check `/health` for the intended backend when startup succeeds.

If you need env-var-only deployment (e.g. platforms without Compose secrets),
use a small compose override that sets `DATABASE_URL` for the app and
`POSTGRES_PASSWORD` for Postgres, and removes the `_FILE` variables.

## Image channels

`docker.io/iuliandita/digarr:latest` is the newest tagged release and the recommended channel for first-time home installs. `:stable` tracks only releases that have been live for at least seven days with no follow-up patch. Only the latest release receives security fixes; `:stable` and pinned versions can lag behind. Use `:MAJOR.MINOR` for patch updates on a release line, or `:MAJOR.MINOR.PATCH` to pin one release. See the [README](../../README.md#quick-start) for current examples. For bleeding-edge testing, `:nightly` (GHCR only) is rebuilt on each push to `develop` with an immutable `:nightly-<sha>` alongside it; the web footer and `GET /health` report the running `gitSha` so a nightly bug report can be pinned to a commit. Images are Alpine-based by default; a Debian/glibc variant ships alongside every release as `:debian`, `-debian`-suffixed version tags, and `:stable-debian`.

## Verifying image signatures

Since v0.27.8, every release image is signed with [cosign](https://github.com/sigstore/cosign) using GitHub OIDC (no long-lived keys). Signatures are stored alongside the image at both `ghcr.io/iuliandita/digarr` and `docker.io/iuliandita/digarr`. Tagged Alpine images also have a container SBOM attached as a signed SPDX attestation bound to the image digest. Debian images have signatures and build provenance, but currently lack container SPDX attestations ([#768](https://github.com/iuliandita/digarr/issues/768)).

Install cosign and verify a pulled image before running it:

```sh
# Replace <TAG> with the exact release version you pulled
cosign verify \
  --certificate-identity-regexp '^https://github\.com/iuliandita/digarr/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  'ghcr.io/iuliandita/digarr:<TAG>'

# Verify the signed container SBOM (Alpine images only)
cosign verify-attestation \
  --type spdxjson \
  --certificate-identity-regexp '^https://github\.com/iuliandita/digarr/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  'ghcr.io/iuliandita/digarr:<TAG>'
```

A successful verify proves the image was built by this repo's `release.yml` workflow on a tagged push. Verify the exact version or digest you intend to run. A valid signature identifies the publishing workflow; it does not guarantee that the software is free of vulnerabilities.
