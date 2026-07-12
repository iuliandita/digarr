# Installing Digarr with Docker Desktop

Works on **macOS** and **Windows** (via WSL 2).

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- At least 2 GB RAM allocated to Docker (Settings > Resources)
  - The embedded-database path is comfortable at 2 GB; bump to 4 GB if you run
    the external PostgreSQL path below

## Install

Digarr ships with an embedded database (PGlite), so the simplest path is a
single container with no database setup and no secret.

### Embedded PGlite (recommended)

```sh
docker run -d --name digarr -p 3000:3000 \
  -v digarr-data:/app/data -v digarr-backups:/app/backups \
  docker.io/iuliandita/digarr:latest
```

Or with compose:

```sh
mkdir digarr && cd digarr
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.pglite.yml
docker compose -f docker-compose.pglite.yml up -d
```

Then jump to [Verify](#verify).

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

Edit `secrets/postgres_password` with a real password, and optionally edit
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

Edit `secrets/postgres_password` with a real password, and optionally edit
`.env`, then:

```powershell
docker compose up -d
```

> **Note:** Use PowerShell or WSL 2 terminal. The classic `cmd.exe` works
> but has weaker env var handling.

## Verify

Open [http://localhost:3000](http://localhost:3000) in your browser.

You can also check container status in Docker Desktop's **Containers** tab
or via `docker compose ps`.

## Update

```sh
docker compose pull
docker compose up -d
```

## Troubleshooting

- **Port conflict:** If port 3000 is in use, change `PORT` in `.env`.
- **Slow startup:** The first pull downloads the container images. Subsequent
  starts reuse the local layers and are faster.
- **Database errors (external PostgreSQL path only):** Ensure
  `secrets/postgres_password` exists, contains only the password on a single
  line, and has no quotes or UTF-8 BOM. If you changed the password after the
  first start, Postgres keeps the old one baked into its data volume -- run
  `docker compose down -v` to reset (this wipes the database). The embedded
  PGlite path has no password and is not affected by this.
