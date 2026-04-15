# Installing Digarr on Synology NAS

## Prerequisites

- Synology DSM 7.1+ with the **Docker** package (DSM 7.1) or **Container Manager** package (DSM 7.2+)
- At least 512 MB free RAM (app uses ~80 MB, PostgreSQL ~30 MB)
- Internet access for pulling images

---

## DSM 7.2+ (Container Manager - has Project support)

Container Manager supports compose projects natively. Use it if you want a no-SSH setup.

### Option A: GUI

1. Open **Container Manager** > **Project** > **Create**
2. Set the project name to `digarr`
3. Set the path to a shared folder (e.g., `/volume1/docker/digarr`)
4. Paste the contents of the [docker-compose.yml](https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml)
5. In the environment/variables section, set at minimum: `DB_PASS` (pick any password - this is internal to the containers)
6. Click **Done**

Both the app and PostgreSQL containers start together automatically.

### Option B: SSH

```sh
mkdir -p /volume1/docker/digarr && cd /volume1/docker/digarr
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
cp .env.example .env
vi .env  # set DB_PASS at minimum
sudo docker compose up -d
```

---

## DSM 7.1 (Docker package - no Project support)

The Docker package on DSM 7.1 does not support compose projects in the GUI.
You can create containers individually with the Launch wizard.

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
- **Start postgres before Digarr.** There's no health-check dependency in
  the GUI (unlike docker compose). If Digarr starts before postgres is
  ready, it crashes and enters a restart loop. Start `digarr-db` first,
  wait for it to go green, then start `digarr`.

### SSH with docker compose (recommended)

The `docker compose` command works via SSH even though the GUI doesn't
support it. Use it on DSM 7.1 if you want the simpler setup path:

```sh
sudo mkdir -p /volume1/docker/digarr && cd /volume1/docker/digarr
sudo curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
sudo curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
sudo cp .env.example .env
```

Edit `.env` and set at least `DB_PASS`:

```sh
sudo vi .env
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
3. **Image** > select `postgres:17-alpine` > **Launch**
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

- PostgreSQL data persists in a volume across restarts and updates.
- Resource usage is low enough for entry-level NAS models (1 GB RAM).
- If using a reverse proxy (Synology's built-in or external), set
  `ALLOWED_ORIGIN` to your public URL (via environment variable or the web UI).
