# Installing Digarr on Unraid

Digarr ships an Unraid Community Applications (CA) container template at
[`deploy/unraid/digarr.xml`](../../deploy/unraid/digarr.xml). The release
pipeline keeps the image digest in that file pinned to the current release, so
the template always tracks a verified image.

Digarr ships with a **built-in embedded database (PGlite)** -- no separate
PostgreSQL container is required. New installs run as a single container that
stores its data in a mapped appdata folder. If you would rather use your own
PostgreSQL, that stays fully supported via the optional Database URL field (see
[Advanced: external PostgreSQL](#advanced-external-postgresql)).

## Prerequisites

- Unraid 6.9+ with the **Community Applications** plugin installed
- An AI provider key (Anthropic, OpenAI, Gemini, Ollama, or any
  OpenAI-compatible endpoint) -- can also be set later in the web UI

---

## Step 1: Add the Digarr template

Digarr is not yet published in the Community Applications store (a CA submission
is pending). Until it lands there, use the bundled template directly -- it is the
reliable route and uses the same XML CA would serve.

### Option A: User template (recommended)

1. Copy [`deploy/unraid/digarr.xml`](../../deploy/unraid/digarr.xml) to your
   Unraid server at
   `/boot/config/plugins/dockerMan/templates-user/my-Digarr.xml`. For example,
   over SSH:

   ```sh
   curl -L -o /boot/config/plugins/dockerMan/templates-user/my-Digarr.xml \
     https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/unraid/digarr.xml
   ```

2. In the Unraid web UI go to **Docker** > **Add Container**.
3. In the **Template** dropdown pick **Digarr** (it appears under your user
   templates).
4. Fill in the configuration (see Step 3) and click **Apply**.

### Option B: Private template repository

If you prefer CA to manage updates to the template, add the repository under
**Apps** > **Settings** (or the CA "Manage template repositories" action) and
point it at `https://github.com/iuliandita/digarr`. Digarr then appears in your
CA search; install it like any other app and fill in the same fields below.

---

## Step 2: Configure the container

The template exposes these fields (matching
[`deploy/unraid/digarr.xml`](../../deploy/unraid/digarr.xml)):

| Field | Variable | Required | Notes |
|-------|----------|----------|-------|
| Web UI Port | host port -> `3000` | Yes | The web interface; WebUI link opens `http://<server-ip>:<port>` |
| Data | path `/app/data` | Yes | Persistent storage for the embedded database. Default maps `/mnt/user/appdata/digarr/data` -> `/app/data`. Must be writable by the container user (uid 1000) |
| Data Path | `DB_PATH` | No (advanced) | Container path of the embedded database, default `/app/data` -- leave it matching the Data mapping |
| Database URL | `DATABASE_URL` | No (advanced) | Leave empty to use the embedded database. Set only to use an external PostgreSQL, e.g. `postgresql://digarr:pass@host:5432/digarr` (see Advanced section) |
| Initial Username | `DIGARR_INITIAL_USERNAME` | No | Auto-creates this admin user on first boot |
| Initial Password | `DIGARR_INITIAL_PASSWORD` | No | Password for the initial admin (min 8 chars) |
| AI Provider | `AI_PROVIDER` | No | `anthropic`, `openai`, `gemini`, `ollama`, `openai-compatible` (or set in UI) |
| AI Model | `AI_MODEL` | No | Model name for the chosen provider |
| AI API Key | `AI_API_KEY` | No | API key for the AI provider |
| AI Base URL | `AI_BASE_URL` | No | Base URL for openai-compatible/ollama endpoints |
| Lidarr URL / API Key | `LIDARR_URL`, `LIDARR_API_KEY` | No | Optional -- discovery works without Lidarr |
| ListenBrainz | `LISTENBRAINZ_USERNAME`, `LISTENBRAINZ_TOKEN` | No | Listening source (advanced) |
| Last.fm | `LASTFM_USERNAME`, `LASTFM_API_KEY` | No | Listening source (advanced) |
| Allowed Origin | `ALLOWED_ORIGIN` | No | Required behind a reverse proxy, e.g. `https://digarr.example.com` |
| Encryption Key | `DIGARR_ENCRYPTION_KEY` | No | 32+ char key for stored tokens (auto-generated if blank) |
| Disable Registration | `DIGARR_DISABLE_REGISTRATION` | No | Defaults to `true`; set `false` to allow new sign-ups |
| Skip TLS Verify | `SKIP_TLS_VERIFY` | No | Skip TLS checks for Lidarr/Jellyfin/etc. connections |
| Webhook URL | `WEBHOOK_URL` | No | Discord, Slack, ntfy, Gotify, or any HTTP endpoint |

Subsonic, Plex, Jellyfin, Emby, Spotify, Deezer, and Discogs connections are not
template fields -- add them later under **Settings -> Connections** in the web UI.

### Recommended: persistent backups volume

The template maps the `Data` folder (`/app/data`) by default, but Digarr's
auto-backup writes to a separate `/app/backups` directory before it applies
database migrations (it keeps the last 14 auto-backups). Add a path mapping in
**Add Container** > **Add another Path** so those survive container recreation:

- Container path: `/app/backups`
- Host path: e.g. `/mnt/user/appdata/digarr/backups`

With the embedded database, your library data lives in the mapped `/app/data`
folder, so persisting that mapping is what protects your recommendations and
settings across updates; the backups volume is the pre-migration safety net.
(With external PostgreSQL, persisting the Postgres database serves that role
instead.)

---

## Step 3: First run

1. Click **Apply** to create and start the container.
2. Open the **WebUI** link (or `http://<server-ip>:3000`).
3. If you set `DIGARR_INITIAL_USERNAME` / `DIGARR_INITIAL_PASSWORD`, log in with
   those; otherwise complete the setup wizard to create the first admin.
4. Database migrations run automatically on every startup. With the embedded
   database this is self-contained; with external PostgreSQL, if Digarr starts
   before Postgres is ready it retries with backoff, so transient startup-order
   races resolve on their own.

---

## Advanced: external PostgreSQL

Skip this section unless you want Digarr to run against your own PostgreSQL
instead of the embedded database. You will need a PostgreSQL 14+ instance
reachable from the Digarr container (a `postgres` container on the same Docker
network is the simplest option).

1. **Apps** (Community Applications) > search for **postgres** > install the
   `postgresql` container (use a 14+ tag, e.g. `postgres:17-alpine`).
2. Set these environment variables on the Postgres container:
   - `POSTGRES_USER` = `digarr`
   - `POSTGRES_PASSWORD` = pick a strong password
   - `POSTGRES_DB` = `digarr`
3. Map a path for the database data dir (e.g.
   `/mnt/user/appdata/digarr-db` -> `/var/lib/postgresql/data`) so it persists.
4. Put both containers on the same Docker network so Digarr can resolve the
   Postgres container by name.
5. In the Digarr template, set the (advanced) **Database URL** field to
   `postgresql://digarr:YOUR_PASSWORD@<postgres-container-name>:5432/digarr`.
   When `DATABASE_URL` is set, Digarr uses PostgreSQL and ignores the embedded
   database; the `/app/data` mapping is then unused.

## Updating

Digarr publishes multi-arch images (amd64 + arm64). To update from the Unraid
**Docker** tab, click the container > **Check for Updates** (or **Force Update**)
and apply. When the template repository (Option B) refreshes, the pinned digest
moves to the newest release.

## Notes

- Keep the AI key, encryption key, and database password out of screenshots and
  shared configs.
- Behind Unraid's reverse proxy (or an external one such as SWAG/Nginx Proxy
  Manager), set `ALLOWED_ORIGIN` to the public URL.
- The container runs as a single process and idles at roughly 80 MB of RAM.
