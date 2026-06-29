# Installing Digarr with Docker Desktop

Works on **macOS** and **Windows** (via WSL 2).

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- At least 4 GB RAM allocated to Docker (Settings > Resources)
  - Default is 2 GB, which is tight for PostgreSQL + Digarr

## Install

### macOS / Linux

```sh
mkdir digarr && cd digarr
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
mkdir -p secrets
# One database password -- both Postgres and the app read this single file.
printf '%s\n' 'change-this-password' > secrets/postgres_password
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
- **Slow startup:** First pull downloads ~200 MB. Subsequent starts are fast.
- **Database errors:** Ensure `secrets/postgres_password` exists, contains only
  the password on a single line, and has no quotes or UTF-8 BOM. If you changed
  the password after the first start, Postgres keeps the old one baked into its
  data volume -- run `docker compose down -v` to reset (this wipes the database).
