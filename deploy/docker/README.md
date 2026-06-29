# Docker deployment

This directory contains the Docker Compose stack for running Digarr in
production or local development.

## Production

```
cd deploy/docker
# Set ONE database password -- both Postgres and the app read this single file.
printf '%s\n' 'change-this-password' > secrets/postgres_password
cp .env.example .env
docker compose up -d
```

Services run on an isolated internal `backend` network; only `app` is exposed
on the host via `frontend`. Pull the image at a specific tag or swap in the
alpine variant by editing `docker-compose.yml`.

## Development with compose

Start dev stack (builds image from local source, exposes postgres on the host):

```
docker compose \
  -f deploy/docker/docker-compose.yml \
  -f deploy/docker/docker-compose.dev.yml up
```

The dev override is additive -- only keys that differ from production are
defined there (build context, postgres port publish). Everything else
(secrets, networks, healthchecks, resource limits) comes from the base file.

## Secrets

The base compose file uses the `_FILE` env convention with a single secret.
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
