# Installing Digarr with Docker Desktop

Works on **macOS** and **Windows** (via WSL 2).

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- At least 2 GB RAM allocated to Docker (Settings > Resources)
  - The embedded-database path is comfortable at 2 GB; bump to 4 GB if you run
    the external PostgreSQL path below

## Install

Digarr ships with an embedded database (PGlite), so the simplest path is a
single container with no separate database setup. Before saving service credentials, configure and retain `DIGARR_ENCRYPTION_KEY`; without it they are stored unencrypted.

### Embedded PGlite (recommended)

```sh
mkdir digarr && cd digarr
(umask 077 && printf 'DIGARR_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" > digarr.env)
docker run -d --name digarr -p 127.0.0.1:3000:3000 \
  --env-file ./digarr.env \
  -e ALLOWED_ORIGIN=http://localhost:3000 \
  -e DIGARR_ALLOW_INSECURE_COOKIES=true \
  -v digarr-data:/app/data -v digarr-backups:/app/backups \
  docker.io/iuliandita/digarr:latest
```

This example is local to this computer and explicitly enables HTTP cookies. Use an HTTPS public origin for access from other devices. OpenSSL generates the encryption key in the protected `digarr.env` file. Keep that file, back it up separately, and reuse it when recreating the container. Run the shell examples below in a macOS terminal or WSL 2.

Or with Compose:

```sh
mkdir digarr && cd digarr
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.pglite.yml
curl -o .env https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
# Edit .env before starting (see below).
docker compose -f docker-compose.pglite.yml up -d
```

In `.env`, set `ALLOWED_ORIGIN=http://localhost:3000`, `DIGARR_ALLOW_INSECURE_COOKIES=true`, and a generated `DIGARR_ENCRYPTION_KEY` for this local HTTP setup. Keep a backup of the key. For HTTPS, use the public origin and leave insecure cookies disabled. These settings apply to both Compose options below. Then jump to [Verify](#verify).

## External PostgreSQL

Use this path if you want Digarr to run against a separate PostgreSQL
container instead of the embedded database.

### macOS / Linux

```sh
mkdir digarr && cd digarr
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
mkdir -p secrets
chmod 700 secrets
# One database password -- both Postgres and the app read this single file.
(umask 077 && printf '%s\n' 'change-this-password' > secrets/postgres_password)
cp .env.example .env
```

Edit `secrets/postgres_password` with a real password, and configure
`.env`, then:

```sh
docker compose up -d
```

### Windows (PowerShell)

```powershell
mkdir digarr; cd digarr
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml" -OutFile "docker-compose.yml"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example" -OutFile ".env"
New-Item -ItemType Directory -Force -Path "secrets"
# WriteAllText avoids the UTF-8 BOM that Set-Content adds, which would corrupt
# the password. Both Postgres and the app read this single file.
[System.IO.File]::WriteAllText("secrets/postgres_password", "change-this-password")
```

Edit `secrets/postgres_password` with a real password, and configure
`.env`, then:

```powershell
docker compose up -d
```

> **Note:** Use PowerShell or WSL 2 terminal. The classic `cmd.exe` works
> but has weaker env var handling.

## Verify

Open [http://localhost:3000](http://localhost:3000) in your browser.

You can also check container status in Docker Desktop's **Containers** tab
or via `docker ps`.

## Update

Take an application backup first. For embedded PGlite:

```sh
docker compose -f docker-compose.pglite.yml pull
docker compose -f docker-compose.pglite.yml up -d
```

For external PostgreSQL, use `docker compose pull app` and `docker compose up -d app`. A `docker run` install needs its container recreated with the same environment and named volumes after pulling the new image; keep both data and backup volumes.

## Troubleshooting

- **Port conflict:** For Compose, change `PORT` in `.env`; for `docker run`, change the host side of `-p`. Update `ALLOWED_ORIGIN` to match.
- **Slow startup:** The first pull downloads the container images. Subsequent
  starts reuse the local layers and are faster.
- **Database errors (external PostgreSQL path only):** Ensure
  `secrets/postgres_password` exists, contains only the password on a single
  line, and has no quotes or UTF-8 BOM. If you changed the password after the
  first start, PostgreSQL keeps the password in its existing database. Restore the working secret file or change the database role password through an authenticated PostgreSQL session. Do not delete the data volume to repair a password mismatch. The embedded
  PGlite path has no password and is not affected by this.
