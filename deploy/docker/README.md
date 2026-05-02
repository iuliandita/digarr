# Docker deployment

This directory contains the Docker Compose stack for running Digarr in
production or local development.

## Production

```
cd deploy/docker
cp secrets/postgres_password.example secrets/postgres_password
cp secrets/database_url.example      secrets/database_url
# edit both files with real values
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

The base compose file uses the `_FILE` env convention. The app reads
`DATABASE_URL_FILE`; Postgres reads `POSTGRES_PASSWORD_FILE`. Create
`secrets/postgres_password` and `secrets/database_url` before starting the
stack; see `secrets/*.example` for the expected format.

If you need env-var-only deployment (e.g. platforms without Compose secrets),
use a small compose override that sets `DATABASE_URL` for the app,
`POSTGRES_PASSWORD` for Postgres, and removes the `_FILE` variables.
