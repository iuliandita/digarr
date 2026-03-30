# Installing Digarr on Synology NAS

## Prerequisites

- Synology DSM 7.1+ with the **Docker** package (DSM 7.1) or **Container Manager** package (DSM 7.2+)
- At least 512 MB free RAM (app uses ~80 MB, PostgreSQL ~30 MB)
- Internet access for pulling images

## Option A: SSH (recommended)

### 1. Create a directory

```sh
mkdir -p /volume1/docker/digarr
cd /volume1/docker/digarr
```

### 2. Download the files

```sh
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
cp .env.example .env
```

### 3. Configure

Edit `.env` and set at least `DB_PASS`:

```sh
vi .env
```

### 4. Start

```sh
sudo docker compose up -d
```

### 5. Verify

```sh
sudo docker compose ps
curl -sf http://localhost:3000/health
```

Open `http://<nas-ip>:3000` in your browser.

## Option B: DSM GUI

1. Open **Docker** (DSM 7.1) or **Container Manager** (DSM 7.2+)
2. Go to **Project** > **Create**
3. Set the project name to `digarr`
4. Set the path to a shared folder (e.g., `/volume1/docker/digarr`)
5. Paste the contents of the [docker-compose.yml](https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml) or upload the file
6. Under **Environment**, add the variables from [.env.example](https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example) (at minimum: `DB_PASS`)
7. Click **Build** / **Done**

## ARM-based Synology models

Digarr publishes multi-arch images (amd64 + arm64). ARM-based models
(DS220j, DS223, DS124, etc.) work out of the box -- Docker pulls the
correct architecture automatically.

## Updating

```sh
cd /volume1/docker/digarr
sudo docker compose pull
sudo docker compose up -d
```

## Notes

- The `pgdata` named volume stores PostgreSQL data. It persists across
  container restarts and updates.
- Resource usage is low enough for entry-level NAS models (1 GB RAM).
- If using a reverse proxy (Synology's built-in or external), set
  `ALLOWED_ORIGIN` in `.env` to your public URL.
