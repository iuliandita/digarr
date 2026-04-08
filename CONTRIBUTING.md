# Contributing to Digarr

## Dev setup

```sh
git clone https://github.com/iuliandita/digarr.git
cd digarr
bun install
```

The fastest way to get a dev environment running:

```sh
./scripts/dev-setup.sh
```

This starts PostgreSQL in Docker, installs deps, runs migrations, and copies `.env.example`.

Or set it up manually:

```sh
docker run -d \
  --name digarr-pg \
  -e POSTGRES_USER=digarr \
  -e POSTGRES_PASSWORD=digarr \
  -e POSTGRES_DB=digarr \
  -p 5432:5432 \
  postgres:17-alpine
```

Copy the env file and set your API keys:

```sh
cp .env.example .env
# edit .env with your Lidarr URL/key, Last.fm key, etc.
```

Run migrations and start the dev servers:

```sh
bun run db:migrate
bun run dev          # backend on :3000
bun run dev:web      # frontend on :5173 (proxies /api to :3000)
```

---

## Code style

Digarr uses [Biome](https://biomejs.dev/) for linting and formatting.

```sh
bun run lint        # check
bun run lint:fix    # auto-fix
```

TypeScript strict mode is enforced. No `any` -- use `unknown`, generics, or proper types.

---

## Testing

```sh
bun run lint
bun run typecheck
bun run test         # run once
bun run test:watch   # watch mode
bun run test:e2e     # Playwright browser tests (needs dev servers running)
bun run test:e2e:ui  # Playwright UI mode
```

Tests live in `tests/`. Keep them close to the code they cover. E2E coverage lives in `tests/e2e/` with `api/` (Vitest smoke tests) and `browser/` (Playwright) subdirectories. Browser tests require `bunx playwright install --with-deps chromium` first, plus both dev servers running (`bun run dev` on `:3000` and `bun run dev:web` on `:5173`).

For route, workflow, or UI changes, run `bun run test:e2e` before opening a PR. CI also runs the smoke and browser suites, but the expectation is that branch diffs affecting those paths get a local pass first.

---

## Submitting a PR

1. Fork and create a branch: `git checkout -b feat/my-thing`
2. Make your changes, keeping commits focused
3. Confirm `lint`, `typecheck`, and `test` all pass
4. Run `bun run test:e2e` if your change affects routes, workflows, or UI behavior
5. Open a PR against `main` -- fill in the template
6. A maintainer will review; be ready to iterate

---

## Commit style

Conventional commits: `type(scope): description`

Types: `feat`, `fix`, `docs`, `refactor`, `chore`, `ci`

Examples:
- `feat(pipeline): add spotify source`
- `fix(lidarr): handle 404 on artist lookup`
- `docs: update contributing guide`
