# Docker deployment

This directory contains the Docker Compose stacks for running Digarr in
production or local development. Two bases are provided:

- `docker-compose.yml` -- the default. Runs the app plus an external
  PostgreSQL container, sharing a single password secret. The database lives in
  the `pgdata` volume and persists across image re-pulls.
- `docker-compose.pglite.yml` -- single container with the embedded PGlite
  database (real PostgreSQL compiled to Wasm, in-process). No database sidecar,
  no secret. Data lives in the `data` volume.

## Production

### Embedded PGlite (single container)

```
cd deploy/docker
docker compose -f docker-compose.pglite.yml up -d
```

No secret to create and no separate database container. The app stores its
data in the `data` volume; `backups` holds the pre-migration auto-backups.

### External PostgreSQL (default)

```
cd deploy/docker
mkdir -p secrets
chmod 700 secrets
# Set ONE database password -- both Postgres and the app read this single file.
(umask 077 && printf '%s\n' 'change-this-password' > secrets/postgres_password)
cp .env.example .env
docker compose up -d
```

Services run on an isolated internal `backend` network; only `app` is exposed
on the host via `frontend`. The default image is the alpine variant; pull a
specific tag or swap in the `-debian` variant by editing `docker-compose.yml`.

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
(it has no effect on the PGlite base, which runs no postgres service).
Everything else (secrets, networks, healthchecks, resource limits) comes from
the chosen base file.

## Secrets

The PGlite base needs no secret. The rest of this section applies only to the
Postgres base (`docker-compose.yml`).

The Postgres base compose file uses the `_FILE` env convention with a single secret.
Postgres reads its password from `POSTGRES_PASSWORD_FILE`, and the app reads the
same file via `DB_PASS_FILE`, then assembles `DATABASE_URL` from `DB_HOST`,
`DB_USER`, `DB_NAME`, and that password. The password therefore lives in exactly
one place -- `secrets/postgres_password` -- so the app and Postgres can never
disagree. Create that file before starting the stack; see
`secrets/postgres_password.example` for the format (one line, the password
only).

If you need env-var-only deployment (e.g. platforms without Compose secrets),
use a small compose override that sets `DATABASE_URL` for the app and
`POSTGRES_PASSWORD` for Postgres, and removes the `_FILE` variables.
