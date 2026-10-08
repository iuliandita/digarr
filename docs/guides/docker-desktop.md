# Installing Digarr with Docker Desktop

Works on **macOS** and **Windows** (via WSL 2).

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- At least 2 GB RAM allocated to Docker (Settings > Resources)
  - The embedded-database path is comfortable at 2 GB; bump to 4 GB if you run
    the bundled PostgreSQL path below

The supplied Compose files require Docker Compose 2.24.0 or newer for `env_file.required`; check with `docker compose version` ([Docker reference](https://docs.docker.com/reference/compose-file/services/#required)). With an older Compose version, replace each long-form `env_file` entry with `env_file: [".env"]` at the same indentation. That form requires a present, protected `.env`; configure it before starting the stack. Alternatively, use the `docker run` path below.

## Install

Digarr ships with an embedded database (PGlite), so the simplest path is a
single container with no separate database setup. Before saving service credentials, configure and retain `DIGARR_ENCRYPTION_KEY`; without it they are stored unencrypted.

On Windows, the embedded PGlite examples require a WSL 2 shell. Run the shell examples in WSL 2 or a macOS terminal with OpenSSL available. The native PowerShell example below is for bundled PostgreSQL only.

The Compose examples expose port 3000 on all host interfaces. Restrict network access until the first admin account exists, bind the published port to `127.0.0.1:3000:3000` for local-only access, or set `DIGARR_INITIAL_USERNAME` and `DIGARR_INITIAL_PASSWORD` before first startup.

### Embedded PGlite (recommended)

```sh
mkdir digarr && cd digarr
(set -C; umask 077 && printf 'DIGARR_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" > digarr.env)
docker run -d --name digarr -p 127.0.0.1:3000:3000 \
  --env-file ./digarr.env \
  -e ALLOWED_ORIGIN=http://localhost:3000 \
  -e DIGARR_ALLOW_INSECURE_COOKIES=true \
  -v digarr-data:/app/data -v digarr-backups:/app/backups \
  docker.io/iuliandita/digarr:latest
```

This example is local to this computer and explicitly enables HTTP cookies. Use an HTTPS public origin for access from other devices. OpenSSL generates the encryption key in the protected `digarr.env` file. Keep that file, back it up separately, and reuse it when recreating the container.

Or with Compose:

```sh
mkdir digarr && cd digarr
curl -fLO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.pglite.yml
test ! -e .env && curl -fL -o .env https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
chmod 600 .env
# Edit .env before starting (see below).
docker compose -f docker-compose.pglite.yml up -d
```

In a WSL 2 or macOS shell, run `openssl rand -hex 32` and save the output as `DIGARR_ENCRYPTION_KEY` in `.env`. Set `ALLOWED_ORIGIN=http://localhost:3000` and `DIGARR_ALLOW_INSECURE_COOKIES=true` for this local HTTP setup. Keep a backup of the key. For HTTPS, use the public origin and leave insecure cookies disabled. These settings apply to the PGlite Compose option above and the PostgreSQL Compose options below. Then jump to [Verify](#verify).

## Bundled PostgreSQL

Use this path if you want Digarr to run against a separate PostgreSQL
container instead of the embedded database.

### macOS or a WSL 2 shell

```sh
mkdir digarr && cd digarr
curl -fLO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
curl -fLO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
mkdir -p secrets
chmod 700 secrets
# One database password -- both Postgres and the app read this single file.
(set -C; umask 077 && printf '%s\n' 'change-this-password' > secrets/postgres_password)
cp -n .env.example .env
chmod 600 .env
# File-backed secrets must be readable by container UID 1000 (mode 0600).
# If your host UID differs: sudo chown 1000:1000 secrets/postgres_password
```

Edit `secrets/postgres_password` with a real password, and configure
`.env`, then:

```sh
docker compose up -d
```

### Windows (native PowerShell, bundled PostgreSQL only)

The commands below generate an encryption key with .NET's cryptographic random-number generator; OpenSSL is not needed. They stop if an existing `.env` or password file would be replaced. For an existing installation, retain those files and its key instead of running this setup again.

```powershell
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path "digarr"
Set-Location "digarr"
$envPath = Join-Path $PWD.Path '.env'
$passwordPath = Join-Path $PWD.Path 'secrets/postgres_password'
if ((Test-Path $envPath) -or (Test-Path $passwordPath)) {
    throw 'Keep the existing environment, encryption key, and database password.'
}
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml" -OutFile "docker-compose.yml"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example" -OutFile ".env"
New-Item -ItemType Directory -Force -Path "secrets"
# WriteAllText writes UTF-8 without a BOM. A BOM would corrupt the password.
# Both Postgres and the app read this single file.
[System.IO.File]::WriteAllText($passwordPath, "change-this-password")
$keyBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($keyBytes) } finally { $rng.Dispose() }
$encryptionKey = [System.BitConverter]::ToString($keyBytes).Replace('-', '').ToLowerInvariant()
[System.IO.File]::AppendAllText($envPath, "`nDIGARR_ENCRYPTION_KEY=$encryptionKey`n")
```

Edit `secrets/postgres_password` with a real password. In `.env`, set `ALLOWED_ORIGIN=http://localhost:3000` and `DIGARR_ALLOW_INSECURE_COOKIES=true` for this local HTTP setup. Retain the generated key, restrict access to both files with Windows file permissions, and back up the key separately. Then:

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

Take a [complete database backup](switching-backends.md#backup-boundaries-and-recovery) and retain the encryption key separately first; application JSON exports omit recovery state. For embedded PGlite:

```sh
docker compose -f docker-compose.pglite.yml pull
docker compose -f docker-compose.pglite.yml up -d
```

For bundled PostgreSQL, use `docker compose pull app` and `docker compose up -d app`. For a `docker run` install, follow the [named-volume backup and update commands](../../deploy/docker/README.md#back-up-and-update); retain the same environment and both named volumes.

## Troubleshooting

- **Port conflict:** For Compose, change `PORT` in `.env`; for `docker run`, change the host side of `-p`. Update `ALLOWED_ORIGIN` to match.
- **Slow startup:** The first pull downloads the container images. Subsequent
  starts reuse the local layers and are faster.
- **Database errors (bundled PostgreSQL path only):** Ensure
  `secrets/postgres_password` exists, contains only the password on a single
  line, and has no quotes, UTF-8 BOM, or intentional leading/trailing whitespace. Digarr trims surrounding whitespace. If you changed the password after the
  first start, PostgreSQL keeps the password in its existing database. Restore the working secret file or change the database role password through an authenticated PostgreSQL session. Do not delete the data volume to repair a password mismatch. The embedded
  PGlite path has no password and is not affected by this.
