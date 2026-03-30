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
cp .env.example .env
```

Edit `.env` and set at least `DB_PASS`, then:

```sh
docker compose up -d
```

### Windows (PowerShell)

```powershell
mkdir digarr; cd digarr
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml" -OutFile "docker-compose.yml"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example" -OutFile ".env"
```

Edit `.env` in your text editor and set at least `DB_PASS`, then:

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
- **Database errors:** Ensure `DB_PASS` is set. PostgreSQL won't start without it.
