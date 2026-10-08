# Installing Digarr on Synology NAS

## Prerequisites

- Synology DSM 7.1+ with the **Docker** package (DSM 7.1) or **Container Manager** package (DSM 7.2+)
- At least 1 GB free RAM; allow more for large libraries, migrations, or a
  separate PostgreSQL container
- Internet access for pulling images

Digarr ships with an embedded database (PGlite), so the simplest setup is a
single container with no separate PostgreSQL. The two-container PostgreSQL path
remains available for anyone who wants it.

---

## Configure browser access first

Before starting the container or Compose project, set `ALLOWED_ORIGIN` to the URL you will open. For direct HTTP, such as `http://<nas-ip>:3000`, also set `DIGARR_ALLOW_INSECURE_COOKIES=true`. For HTTPS through a reverse proxy, use its public HTTPS origin and leave insecure cookies disabled. Neither origin configuration nor this cookie override is a web UI setting.

Generate a key into a [protected file](../AUTHENTICATION.md#generate-a-new-encryption-key) on a computer with OpenSSL. Set and retain that exact `DIGARR_ENCRYPTION_KEY` before entering service credentials. For Compose, put these settings in a protected `.env` in the project folder; for the Launch wizard, add them under Environment. Back up the key separately. See [authentication](../AUTHENTICATION.md#public-origin-and-reverse-proxies).

The first account becomes admin. Restrict access to the published port until the intended admin account exists and you have verified it, including when `DIGARR_INITIAL_USERNAME` and `DIGARR_INITIAL_PASSWORD` are configured. The HTTP listener opens before environment-based bootstrap finishes ([#785](https://github.com/iuliandita/digarr/issues/785)). The Compose and Launch wizard examples expose the service on host interfaces unless you restrict the binding or firewall.

## Compose compatibility

The supplied Compose files require Docker Compose 2.24.0 or newer for `env_file.required`; check with `docker compose version` ([Docker reference](https://docs.docker.com/reference/compose-file/services/#required)). With an older Compose version, replace each long-form `env_file` entry with `env_file: [".env"]` at the same indentation. That form requires a present, protected `.env`; configure it before starting the stack. The Compose version bundled with DSM varies; do not infer compatibility from the DSM version. If the project rejects the file, use a compatible Compose installation over SSH or the individual-container Launch wizard below.

## DSM 7.2+ (Container Manager - has Project support)

Container Manager supports compose projects natively. Use it if you want a
no-SSH setup. Pick one of the two paths below.

### Option 1: Embedded PGlite (recommended, single container)

GUI:

1. Open **Container Manager** > **Project** > **Create**
2. Set the project name to `digarr`
3. Set the path to a shared folder (e.g., `/volume1/docker/digarr`)
4. Paste the contents of the [docker-compose.pglite.yml](https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.pglite.yml)
5. For a first installation, create a protected `.env` in the project folder with `ALLOWED_ORIGIN`, `DIGARR_ALLOW_INSECURE_COOKIES` for direct HTTP, and `DIGARR_ENCRYPTION_KEY`, as described above. On upgrades, reuse the existing `.env` and encryption key.
6. Click **Done**

There is no database-password file to create. The app stores its data in the project's `data`
volume.

SSH (first installation only):

Reuse the existing `.env`, encryption key, and database-password file on upgrades; follow [Updating](#updating) instead of rerunning setup. The commands below refuse to overwrite existing secret files.

```sh
(
set -e
mkdir -p /volume1/docker/digarr && cd /volume1/docker/digarr
curl -fLO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.pglite.yml
(set -C; umask 077; curl -fL https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example > .env)
chmod 600 .env
# Edit .env: set the origin, HTTP cookie override, and a saved encryption key.
sudo docker compose -f docker-compose.pglite.yml up -d
)
```

### Option 2: Bundled PostgreSQL (two containers)

GUI:

1. Open **Container Manager** > **Project** > **Create**
2. Set the project name to `digarr`
3. Set the path to a shared folder (e.g., `/volume1/docker/digarr`)
4. Paste the contents of the [docker-compose.yml](https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml)
5. For a first installation, create one file in the project folder before starting:
   - `secrets/postgres_password` containing only the original database password, with no intentional leading or trailing whitespace. Both the app and PostgreSQL read this single configuration source; Digarr trims surrounding whitespace. Changing the file does not change the password in an initialized PostgreSQL database: update the database role password separately and coordinate the app credentials.
   - Keep the folder restricted, but make the password file readable by container UID 1000. Over SSH, run `sudo chown 1000:1000 secrets/postgres_password` and `sudo chmod 600 secrets/postgres_password` from the project folder. File-backed secrets retain host ownership; restricting the file to another DSM UID prevents app login to PostgreSQL.
6. For a first installation, create the protected `.env` with the origin, cookie, and encryption settings before starting. On upgrades, reuse the existing `.env`, encryption key, and database-password file.
7. Click **Done**

Both the app and PostgreSQL containers start together automatically.

SSH (first installation only):

Reuse the existing `.env`, encryption key, and database-password file on upgrades; follow [Updating](#updating) instead of rerunning setup. The commands below refuse to overwrite existing secret files.

```sh
(
set -e
mkdir -p /volume1/docker/digarr && cd /volume1/docker/digarr
curl -fLO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
(set -C; umask 077; curl -fL https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example > .env)
mkdir -p secrets
chmod 700 secrets
(set -C; umask 077; printf '%s\n' 'change-this-password' > secrets/postgres_password)
vi secrets/postgres_password
sudo chown 1000:1000 secrets/postgres_password
sudo chmod 600 secrets/postgres_password
# Set ALLOWED_ORIGIN, the HTTP cookie override if needed, and the saved key in .env.
vi .env
sudo docker compose up -d
)
```

---

## DSM 7.1 (Docker package - no Project support)

The Docker package on DSM 7.1 does not support compose projects in the GUI.
You can create containers individually with the Launch wizard.

### Embedded PGlite (recommended, single container)

With the embedded database there is no second container, no custom network,
and no database startup dependency.

1. **Docker** > **Registry** > search for `iuliandita/digarr`
2. Download `iuliandita/digarr:latest`
3. **Image** > select `iuliandita/digarr:latest` > **Launch**
4. Container name: `digarr`
5. **Port Settings**: set local port `3000` > container port `3000`
6. Click **Advanced Settings** > **Volume** - add two folder mappings:
   - `/volume1/docker/digarr/data` -> `/app/data` (the embedded database)
   - `/volume1/docker/digarr/backups` -> `/app/backups` (pre-migration backups)
7. Still in **Advanced Settings** > **Environment** - add:
   - `ALLOWED_ORIGIN` = `http://<nas-ip>:3000` for direct HTTP
   - `DIGARR_ALLOW_INSECURE_COOKIES` = `true` for direct HTTP (leave false for HTTPS)
   - `DIGARR_ENCRYPTION_KEY` = a generated, saved secret
   - `DIGARR_INITIAL_USERNAME` = optional admin username
   - `DIGARR_INITIAL_PASSWORD` = optional initial password (min 12 chars)
8. Click **Next** / **Apply** to create and start the container

Both mapped folders, `data` and `backups`, must be writable by container UID 1000 before startup. Set the shared-folder permissions in DSM, or use `sudo chown 1000:1000 /volume1/docker/digarr/data /volume1/docker/digarr/backups` over SSH after creating the folders. This applies to any bind mounts; Compose-managed named volumes are separate from these DSM folder mappings.

Open `http://<nas-ip>:3000` in your browser.

If you prefer compose over SSH, the single-container PGlite stack also works
on DSM 7.1. These commands are for a first installation only; reuse the existing `.env` and encryption key on upgrades:

```sh
(
set -e
sudo mkdir -p /volume1/docker/digarr && cd /volume1/docker/digarr
sudo curl -fLO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.pglite.yml
sudo sh -c 'set -C; umask 077; curl -fL https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example > .env'
sudo chmod 600 .env
# Use sudo vi .env: set the origin, HTTP cookie override, and a saved encryption key.
sudo docker compose -f docker-compose.pglite.yml up -d
)
```

---

## Advanced: separate PostgreSQL server (DSM 7.1)

Use this only if you want Digarr to run against your own PostgreSQL instead of
the embedded database. It requires two containers on a shared network.

### DSM 7.1 gotchas

- **Settings are locked after creation.** Network, environment variables,
  and volume mappings can only be set during the Launch wizard. If you need
  to change anything, delete the container and recreate it.
- **`localhost` doesn't mean what you think.** Each container has its own
  network namespace. `localhost` inside the Digarr container points to
  itself, not the NAS or the postgres container. Use a custom network with
  container names as hostnames instead.
- **Create the custom network first.** The Launch wizard shows a Network
  step where you can pick a custom bridge network. Both containers must be
  on the same custom network for hostname resolution to work.
- **Start postgres before Digarr when practical.** The DSM GUI has no
  health-check dependency. Digarr now retries the database connection with
  backoff instead of immediately crash-looping, but starting `digarr-db` first
  still gives the cleanest first boot.

### SSH with docker compose (recommended)

The `docker compose` command works via SSH even though the GUI doesn't
support it. Use it on DSM 7.1 if you want the simpler setup path. This Compose file bundles PostgreSQL as a separate container. These commands are for a first installation only; reuse the existing `.env`, encryption key, and password file on upgrades:

```sh
(
set -e
sudo mkdir -p /volume1/docker/digarr && cd /volume1/docker/digarr
sudo curl -fLO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
sudo sh -c 'set -C; umask 077; curl -fL https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example > .env'
sudo mkdir -p secrets
sudo chmod 700 secrets
sudo sh -c 'set -C; umask 077; printf "%s\n" "change-this-password" > secrets/postgres_password'
sudo chmod 600 secrets/postgres_password
sudo chown 1000:1000 secrets/postgres_password
)
```

The file is owned by UID 1000 so the app can read its mode-0600 bind-mounted secret; the PostgreSQL entrypoint reads it as root. Digarr trims leading and trailing whitespace, so do not use a password with intentional surrounding whitespace in this file. Changing the file does not change an initialized PostgreSQL role password; coordinate that change separately. Edit the secret file with a real password:

```sh
cd /volume1/docker/digarr && sudo vi secrets/postgres_password
```

Edit `.env` before startup: set the public origin, the HTTP cookie override when needed, and the saved encryption key. Keep the existing key on upgrades.

```sh
cd /volume1/docker/digarr && sudo vi .env
```

Start both containers:

```sh
cd /volume1/docker/digarr && sudo docker compose up -d
```

The compose file handles networking, health checks, and startup order
automatically. Both containers share a compose-managed network where they
can reach each other by service name.

### GUI (two containers)

If you prefer the GUI, you must create each container separately. A custom
network lets them reach each other by container name.

> **Important:** DSM 7.1 only shows network and environment settings during
> container **creation**. You cannot change them afterward - if you make a
> mistake, delete the container and recreate it. Using `localhost` in
> DATABASE_URL will not work - each container has its own network namespace.

#### Step 1: Create a network

1. **Docker** > **Network** > **Add**
2. Name: `digarr-net`, Driver: `bridge`
3. Click **Add**

#### Step 2: Create the PostgreSQL container

1. **Docker** > **Registry** > search for `postgres`
2. Download `postgres:17-alpine`
3. **Image** > select
   `postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`
   if your DSM build supports digest references; otherwise select
   `postgres:17-alpine` > **Launch**
4. **Network**: select `digarr-net` (deselect `bridge`)
5. Container name: `digarr-db`
6. Click **Advanced Settings** > **Environment** - add these variables:
   - `POSTGRES_USER` = `digarr`
   - `POSTGRES_PASSWORD` = pick a password (remember it for step 3)
   - `POSTGRES_DB` = `digarr`
7. Still in **Advanced Settings** > **Volume** - add a folder mapping:
   - File/Folder: create `/volume1/docker/digarr-db` (or any path)
   - Mount path: `/var/lib/postgresql/data`
8. Click **Next** / **Apply** to create and start the container
9. Verify it's running in **Container** (green status)

#### Step 3: Create the Digarr container

1. **Registry** > search for `iuliandita/digarr`
2. Download `iuliandita/digarr:latest`
3. **Image** > select `iuliandita/digarr:latest` > **Launch**
4. **Network**: select `digarr-net` (deselect `bridge`)
5. Container name: `digarr`
6. **Port Settings**: set local port `3000` > container port `3000`
7. Click **Advanced Settings** > **Environment** - add these variables:
   - `ALLOWED_ORIGIN` = `http://<nas-ip>:3000` for direct HTTP
   - `DIGARR_ALLOW_INSECURE_COOKIES` = `true` for direct HTTP (leave false for HTTPS)
   - `DIGARR_ENCRYPTION_KEY` = a generated, saved secret
   - `DATABASE_URL` = `postgresql://digarr:YOUR_PASSWORD@digarr-db:5432/digarr`
     (replace `YOUR_PASSWORD` with the percent-encoded password from step 2;
     `digarr-db` resolves because both containers are on `digarr-net`)
   - `DIGARR_INITIAL_USERNAME` = optional admin username
   - `DIGARR_INITIAL_PASSWORD` = optional initial password (min 12 chars)
8. Still in **Advanced Settings** > **Volume**, create `/volume1/docker/digarr/backups` and map it to `/app/backups`. Make the folder writable by container UID 1000 before startup using DSM permissions, or `sudo chown 1000:1000 /volume1/docker/digarr/backups` over SSH.
9. Click **Next** / **Apply** to create and start the container

Keep that same backup-folder mapping when recreating the app container. These automatic application exports omit recovery state and do not replace a [complete PostgreSQL backup](switching-backends.md#backup-boundaries-and-recovery). Retain the encryption key separately.

Digarr passes an explicit `DATABASE_URL` unchanged. Percent-encode the username, password, and database-name components when needed, not the whole URL: `pass#word` becomes `pass%23word`, and a literal `%` becomes `%25`. Keep the original, unencoded password in `POSTGRES_PASSWORD`, direct `DB_PASS`, or the password file. Enter real credentials in the protected configuration or GUI, not command-line arguments. For separate `DB_*` settings, use only URI-unreserved characters (`A-Z`, `a-z`, `0-9`, `-`, `.`, `_`, `~`) in `DB_USER` and `DB_NAME`; other names require a complete, percent-encoded `DATABASE_URL` ([#773](https://github.com/iuliandita/digarr/issues/773)). `DB_PASS_FILE` trims surrounding whitespace, so password files must not contain intentional leading or trailing whitespace.

Open `http://<nas-ip>:3000` in your browser.

---

## ARM-based Synology models

Digarr publishes amd64 and arm64 images. CPU architecture alone does not establish NAS compatibility: the model and DSM version must also support Docker or Container Manager. Check package availability for your NAS before using this guide.

## Updating

### Compose (SSH or DSM 7.2 Project)

Take a [complete database backup](switching-backends.md#backup-boundaries-and-recovery) and retain the encryption key separately before upgrading; application JSON exports omit recovery state. Keep the same project name, volume mappings, and environment.

```sh
cd /volume1/docker/digarr
sudo docker compose -f docker-compose.pglite.yml pull
sudo docker compose -f docker-compose.pglite.yml up -d
```

For the PostgreSQL stack, use `docker-compose.yml` instead and pull only `app` when updating Digarr.

### GUI (DSM 7.1)

Take a [complete database backup](switching-backends.md#backup-boundaries-and-recovery) and retain the encryption key separately before resetting the container; application JSON exports omit recovery state. Confirm the existing data and backup folder mappings and environment will be retained.

1. Open **Docker** > **Registry** > search for `iuliandita/digarr`
2. Download the latest tag
3. Stop the `digarr` container
4. **Action** > **Reset** (this recreates the container with the new image)
5. Start the container

PostgreSQL does not need to be updated unless you specifically want a newer version.

## Notes

- With the embedded database, your data lives in the mapped `/app/data`
  directory and persists across restarts and updates (keep the `/app/backups`
  mapping too for the pre-migration safety net). With PostgreSQL in a separate container, the
  database volume persists instead.
- Resource use depends on library size and background work; keep at least 1 GB
  free and watch the container during migrations or large syncs.
- If using a reverse proxy (Synology's built-in or external), set
  `ALLOWED_ORIGIN` to your public `https://` URL through the environment and leave `DIGARR_ALLOW_INSECURE_COOKIES` at its default `false`.
  Session cookies stay `Secure` even though the proxy reaches the container over
  HTTP.
- If you instead reach Digarr directly over plain HTTP (no proxy), set
  `DIGARR_ALLOW_INSECURE_COOKIES=true` before your first login and point
  `ALLOWED_ORIGIN` at the matching `http://` URL, otherwise the browser drops
  the `Secure` cookie and login appears to fail. Direct HTTP exposes the
  session cookie to network interception.
