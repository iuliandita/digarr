# Contributing to Digarr

## Dev setup

Install Bun, Node.js (Vitest runs under Node), Docker, and the PostgreSQL client tools (`pg_isready`). Development uses local ports 5432, 3000, and 5173; browser tests also use 3011 for the mock sign-in provider. Keep these ports free.

```sh
git clone https://github.com/iuliandita/digarr.git
cd digarr
bun install
```

Run `./scripts/dev-setup.sh` to start a dev environment:

```sh
./scripts/dev-setup.sh
```

This starts PostgreSQL in Docker, installs deps, runs migrations, and copies `.env.example`. Then start both dev servers as shown below and open `http://localhost:5173`.

Or set it up manually:

```sh
docker run -d \
  --name digarr-pg \
  -e POSTGRES_USER=digarr \
  -e POSTGRES_PASSWORD=digarr \
  -e POSTGRES_DB=digarr \
  -p 5432:5432 \
  postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73
```

Copy the env file and set your API keys:

```sh
cp .env.example .env
# edit .env with your Lidarr URL/key, Last.fm key, etc.
```

For manual setup only, run migrations:

```sh
bun run db:migrate
```

For either setup path, start the dev servers:

```sh
# Run these in separate terminals:
bun run dev          # backend on :3000
bun run dev:web      # frontend on :5173 (proxies /api to :3000)
```

## Code style

Digarr uses [Biome](https://biomejs.dev/) for linting and formatting.

```sh
bun run lint        # check
bun run lint:fix    # auto-fix
```

TypeScript strict mode is enforced. No `any`; use `unknown`, generics, or proper types.

## Testing

```sh
bun run lint
bun run typecheck
bun run test:api-routes
bun run test:coverage
bun run i18n:check
bun run check:docs   # versions, API inventory, links, environment names, source-impact receipts
bun run test         # run once
bun run test:watch   # watch mode
bun run test:e2e     # Playwright browser tests (starts test dev servers)
bun run test:e2e:ui  # Playwright UI mode
bun run test:e2e:a11y # Accessibility checks
```

Tests live in `tests/`. Keep them close to the code they cover. Route-contract coverage lives in `tests/api-routes/`; browser coverage lives in `tests/e2e/browser/`; accessibility coverage lives in `tests/e2e/a11y/`. Install browsers with `bunx playwright install --with-deps chromium firefox` first. With `DATABASE_URL` or complete `DB_HOST`/`DB_USER`/`DB_NAME` settings (including values in `.env`), Playwright derives a `<database>_playwright` database, terminates its connections, and drops and recreates it on every run. Use an isolated development server and an account with database create/drop permissions; never point this at a database you need to keep. Without an external database configuration, browser tests use temporary PGlite storage and need no PostgreSQL server. By default, Playwright starts an isolated backend on `:3000`, Vite on `:5173`, and the mock sign-in provider on `:3011`. Set `PLAYWRIGHT_SKIP_WEBSERVER=1` only when all required test servers are already running.

For route, workflow, or UI changes, run `bun run test:e2e` before opening a PR. CI also runs the smoke and browser suites, but the expectation is that branch diffs affecting those paths get a local pass first.

## Translations

Edit the authored locale catalogs following the [translation workflow](src/core/i18n/messages/README.md). Add each new English key to every shipped locale and run `bun run i18n:check` before submitting. English fallback at runtime does not replace complete translations.

## Recommendation quality

Use the [recommendation evaluation guide](docs/RECOMMENDATION-QUALITY.md) before changing prompts or ranking. `bun run eval:quality prepare` generates production-prompt cases without network calls. Live Promptfoo comparisons remain manual and advisory; saved outputs can be replayed locally. Synthetic profiles and automated plausibility checks do not establish human recommendation fit.

## Documentation maintenance

Run `bun run check:docs` with every change. Review affected guides and record source-impact receipts following [Keeping documentation current](docs/MAINTENANCE.md). Breaking changes need compatibility and upgrade instructions; migrations need backup and rollback instructions. A specific no-impact explanation is appropriate only when the diff preserves documented behavior.

## Submitting a PR

1. Create a branch from `develop`: `git checkout develop && git pull --ff-only && git checkout -b feat/my-thing`
2. Make your changes, keeping commits focused
3. Confirm `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:api-routes`, `bun run i18n:check`, `bun run check:docs` all pass
4. Run `bun run test:e2e` if your change affects routes, workflows, or UI behavior
5. Open a PR against `develop` and fill in the template. `main` receives release-promotion PRs from `develop`, not normal feature branches
6. A maintainer will review; be ready to iterate

## Commit style

Conventional commits: `type(scope): description`

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `revert`. Activate the commit-message and pre-push checks once per clone:

```sh
git config --local core.hooksPath .githooks
```

Examples:
- `feat(pipeline): add spotify source`
- `fix(lidarr): handle 404 on artist lookup`
- `docs: update contributing guide`

Keep commit and squash-merge titles plain ASCII and at most 72 characters;
move detail into the body instead of the subject line.
