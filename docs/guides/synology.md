# Installing Digarr on Synology NAS

## Prerequisites

- Synology DSM 7.1+ with the **Docker** package (DSM 7.1) or **Container Manager** package (DSM 7.2+)
- At least 1 GB free RAM; allow more for large libraries, migrations, or an
  external PostgreSQL container
- Internet access for pulling images

Digarr ships with an embedded database (PGlite), so the simplest setup is a
single container with no separate PostgreSQL. The two-container PostgreSQL path
remains available for anyone who wants it.

---

## DSM 7.2+ (Container Manager - has Project support)

Container Manager supports compose projects natively. Use it if you want a
no-SSH setup. Pick one of the two paths below.

### Option 1: Embedded PGlite (recommended, single container, no secret)

GUI:

1. Open **Container Manager** > **Project** > **Create**
2. Set the project name to `digarr`
3. Set the path to a shared folder (e.g., `/volume1/docker/digarr`)
4. Paste the contents of the [docker-compose.pglite.yml](https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.pglite.yml)
5. Click **Done**

There is no secret to create. The app stores its data in the project's `data`
volume.

SSH:

```sh
mkdir -p /volume1/docker/digarr && cd /volume1/docker/digarr
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.pglite.yml
sudo docker compose -f docker-compose.pglite.yml up -d
```

### Option 2: External PostgreSQL (two containers)

GUI:

1. Open **Container Manager** > **Project** > **Create**
2. Set the project name to `digarr`
3. Set the path to a shared folder (e.g., `/volume1/docker/digarr`)
4. Paste the contents of the [docker-compose.yml](https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml)
5. Create one file in the project folder before starting:
   - `secrets/postgres_password` containing only the database password (both
     the app and PostgreSQL read this single file, so there is nothing to keep
     in sync)
6. Click **Done**

Both the app and PostgreSQL containers start together automatically.

SSH:

```sh
mkdir -p /volume1/docker/digarr && cd /volume1/docker/digarr
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
mkdir -p secrets
printf '%s\n' 'change-this-password' > secrets/postgres_password
cp .env.example .env
vi secrets/postgres_password
sudo docker compose up -d
```

---

## DSM 7.1 (Docker package - no Project support)

The Docker package on DSM 7.1 does not support compose projects in the GUI.
You can create containers individually with the Launch wizard.

### Embedded PGlite (recommended, single container)

With the embedded database there is no second container, no custom network,
and no startup-order problem -- create one container and you are done.

1. **Docker** > **Registry** > search for `iuliandita/digarr`
2. Download `iuliandita/digarr:latest`
3. **Image** > select `iuliandita/digarr:latest` > **Launch**
4. Container name: `digarr`
5. **Port Settings**: set local port `3000` -> container port `3000`
6. Click **Advanced Settings** > **Volume** - add two folder mappings:
   - `/volume1/docker/digarr/data` -> `/app/data` (the embedded database)
   - `/volume1/docker/digarr/backups` -> `/app/backups` (pre-migration backups)
7. Still in **Advanced Settings** > **Environment** - optionally add:
   - `DIGARR_INITIAL_USERNAME` = pick an admin username
   - `DIGARR_INITIAL_PASSWORD` = pick a password (min 8 chars)
8. Click **Next** / **Apply** to create and start the container

The mapped `data` directory must be writable by the container user (uid 1000);
on Synology set the shared folder permissions or `chown 1000:1000` the folder
over SSH if the container reports a permission error on first boot.

Open `http://<nas-ip>:3000` in your browser.

If you prefer compose over SSH, the single-container PGlite stack also works
on DSM 7.1:

```sh
sudo mkdir -p /volume1/docker/digarr && cd /volume1/docker/digarr
sudo curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.pglite.yml
sudo docker compose -f docker-compose.pglite.yml up -d
```

---

## Advanced: external PostgreSQL (DSM 7.1)

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
support it. Use it on DSM 7.1 if you want the simpler setup path:

```sh
sudo mkdir -p /volume1/docker/digarr && cd /volume1/docker/digarr
sudo curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
sudo curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
sudo mkdir -p secrets
printf '%s\n' 'change-this-password' | sudo tee secrets/postgres_password > /dev/null
sudo cp .env.example .env
```

Edit the secret file with a real password:

```sh
sudo vi secrets/postgres_password
```

Start both containers:

```sh
sudo docker compose up -d
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
   `postgres:17-alpine@sha256:c7526c0f6c3f30260a563d7bcf8ad778effac59a44f8ffa86678c35418338609`
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
6. **Port Settings**: set local port `3000` -> container port `3000`
7. Click **Advanced Settings** > **Environment** - add these variables:
   - `DATABASE_URL` = `postgresql://digarr:YOUR_PASSWORD@digarr-db:5432/digarr`
     (replace `YOUR_PASSWORD` with the password from step 2 - the hostname
     `digarr-db` resolves because both containers are on `digarr-net`)
   - `DIGARR_INITIAL_USERNAME` = pick an admin username
   - `DIGARR_INITIAL_PASSWORD` = pick a password (min 8 chars)
8. Click **Next** / **Apply** to create and start the container

Open `http://<nas-ip>:3000` in your browser.

---

## ARM-based Synology models

Digarr publishes multi-arch images (amd64 + arm64). ARM-based models
(DS220j, DS223, DS124, etc.) work out of the box - Docker pulls the
correct architecture automatically.

## Updating

### Compose (SSH or DSM 7.2 Project)

```sh
cd /volume1/docker/digarr
sudo docker compose pull
sudo docker compose up -d
```

### GUI (DSM 7.1)

1. Open **Docker** > **Registry** > search for `iuliandita/digarr`
2. Download the latest tag
3. Stop the `digarr` container
4. **Action** > **Reset** (this recreates the container with the new image)
5. Start the container

PostgreSQL does not need to be updated unless you specifically want a newer version.

## Notes

- With the embedded database, your data lives in the mapped `/app/data`
  directory and persists across restarts and updates (keep the `/app/backups`
  mapping too for the pre-migration safety net). With external PostgreSQL, the
  database volume persists instead.
- Resource use depends on library size and background work; keep at least 1 GB
  free and watch the container during migrations or large syncs.
- If using a reverse proxy (Synology's built-in or external), set
  `ALLOWED_ORIGIN` to your public URL (via environment variable or the web UI).
