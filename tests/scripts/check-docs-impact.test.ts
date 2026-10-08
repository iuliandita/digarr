// @vitest-environment node

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acceptReview,
  COMPANION_REPOS,
  checkContracts,
  createBaseline,
  DOMAIN_NAMES,
  DOMAINS,
  createSnapshot as engineSnapshot,
  LOCK_PATH,
  normalizeSource,
  type Review,
  readBaseContext,
  snapshotDigest,
  specificExplanation,
  validateLock,
} from '../../scripts/lib/docs-contracts'

const checker = resolve('scripts/check-docs-impact.ts')
const roots: string[] = []
const initialNote = 'Initial source impact baseline records existing documentation contracts.'
const impactNote = 'Reviewed the changed behavior and updated the operator documentation.'
const noImpactNote = 'Internal formatting changes preserve all documented operator behavior.'
const migrationNote =
  'Upgrade applies the schema change; rollback requires restoring a compatible backup.'

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'digarr-contracts-'))
  roots.push(root)
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      version: '1.0.0',
      scripts: { start: 'bun src/index.ts' },
      dependencies: { hono: '1.0.0' },
    }),
    'src/core/feature.ts': 'export const enabled = true\n',
    'src/core/auth/session.ts': 'export const cookieSecure = true\n',
    'src/config/env.ts': 'export const port = 3000\n',
    'src/db/schema.ts': 'export const schema = {}\n',
    'src/server/routes/health.ts': 'export const health = true\n',
    'src/server/helpers/openapi-doc.ts': 'export const schema = {}\n',
    'src/web/App.tsx': 'export const title = "Welcome"\n',
    'drizzle/0000_initial.sql': 'CREATE TABLE users (id integer);\n',
    'drizzle/meta/_journal.json': '{"entries":[0]}\n',
    'deploy/docker/Dockerfile': 'FROM oven/bun:1\n',
    'deploy/docker/.env.example': 'PORT=3000\n',
    'deploy/helm/digarr/templates/_helpers.tpl': '{{ define "app.name" }}digarr{{ end }}\n',
    'deploy/helm/digarr/templates/NOTES.txt': 'Visit the application after installation.\n',
    'deploy/unraid/digarr.xml':
      '<Container><Repository>docker.io/iuliandita/digarr:1.0.0</Repository><Tag>1.0.0</Tag><TagDescription>v1.0.0 release</TagDescription><Config Default="true">true</Config></Container>\n',
    'public/sw.js': 'const cache = "v1"\n',
    'scripts/check.ts': 'console.log("check")\n',
    '.github/workflows/ci.yml': 'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n',
    '.env.example': 'PORT=3000\n',
  }
  for (const [path, content] of Object.entries(files)) write(root, path, content)
  for (const domain of DOMAIN_NAMES)
    for (const doc of DOMAINS[domain].allowedDocs)
      if (doc.endsWith('.md')) write(root, doc, `${doc}\nExisting operator documentation.\n`)
  return root
}

function baseline(root: string) {
  return createBaseline(
    root,
    createSnapshot(root),
    initialNote,
    COMPANION_REPOS.map((repo) => ({
      repo,
      status: 'unaffected',
      note: 'Synthetic fixture has no external companion changes to review.',
    })),
  )
}

function createSnapshot(root: string) {
  return engineSnapshot(root, { allowNonGit: true })
}

function receipt(overrides: Partial<Omit<Review, 'digest'>> = {}): Omit<Review, 'digest'> {
  return {
    outcome: 'no-impact',
    docs: [],
    note: noImpactNote,
    breaking: 'none',
    migration: '',
    ...overrides,
  }
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function initGit(root: string): string {
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Contract Tests')
  git(root, 'config', 'user.email', 'tests@example.com')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Initial fixture')
  return git(root, 'rev-parse', 'HEAD')
}

function save(root: string, lock: unknown): void {
  write(root, LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`)
}

function cli(root: string, ...args: string[]) {
  return spawnSync('bun', [checker, ...args], { cwd: root, encoding: 'utf8' })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('documentation contract snapshots', () => {
  it('requires explicit filesystem fallback outside Git', () => {
    const root = fixture()
    expect(() => engineSnapshot(root)).toThrow('source snapshot requires Git')
    expect(() => engineSnapshot(root, { allowNonGit: true })).not.toThrow()
  })

  it('inventories only tracked/staged sources and excludes ignored/untracked scratch files', () => {
    const root = fixture()
    write(root, '.gitignore', 'src/private-*.yaml\nscripts/private-*.py\n')
    initGit(root)
    const before = engineSnapshot(root)
    write(root, 'src/private-config.yaml', 'private: never-read\n')
    write(root, 'scripts/private-helper.py', 'private_data = "never-read"\n')
    write(root, 'scripts/scratch.yaml', 'private: never-read\n')
    write(root, 'scripts/scratch.py', 'private_data = "never-read"\n')
    write(root, 'src/new/runtime/handler.ts', 'export const added = true\n')
    expect(engineSnapshot(root)).toEqual(before)
    git(root, 'add', 'src/new/runtime/handler.ts')
    const staged = engineSnapshot(root)
    expect(Object.keys(staged.features.files)).toContain('src/new/runtime/handler.ts')
    expect(Object.keys(staged.maintenance.files)).not.toContain('scripts/scratch.py')
    write(root, 'src/config/env.ts', 'export const port = 4000\n')
    expect(engineSnapshot(root).configuration.digest).not.toBe(before.configuration.digest)
  })

  it('is deterministic without git and covers all domains and operational file types', () => {
    const root = fixture()
    const first = createSnapshot(root)
    expect(createSnapshot(root)).toEqual(first)
    expect(Object.keys(first)).toEqual(DOMAIN_NAMES)
    expect(first.deployment.files).toHaveProperty('deploy/docker/Dockerfile')
    expect(Object.keys(first.deployment.files)).toContain(
      'deploy/helm/digarr/templates/_helpers.tpl',
    )
    expect(Object.keys(first.deployment.files)).toContain('deploy/helm/digarr/templates/NOTES.txt')
    expect(Object.keys(first['data-recovery'].files)).toContain('drizzle/0000_initial.sql')
    expect(checkContracts(root, baseline(root), first)).toEqual([])
  })

  it.each([
    ['configuration', 'src/config/env.ts', 'export const port = 4000\n'],
    ['authentication', 'src/server/routes/oauth-new.ts', 'export const insecure = true\n'],
    ['data-recovery', 'src/db/schema.ts', 'export const schema = {newColumn: true}\n'],
    ['features', 'src/new/runtime/handler.ts', 'export const newBehavior = true\n'],
    ['maintenance', 'scripts/new-helper.py', 'print("new behavior")\n'],
  ] as const)('detects %s source changes without acknowledgement', (domain, path, content) => {
    const root = fixture()
    const lock = baseline(root)
    write(root, path, content)
    expect(checkContracts(root, lock, createSnapshot(root))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain, message: expect.stringContaining(path) }),
      ]),
    )
  })

  it('detects removed sources and fails closed when a root or domain empties', () => {
    const root = fixture()
    const lock = baseline(root)
    rmSync(join(root, 'src/server/routes/health.ts'))
    expect(checkContracts(root, lock, createSnapshot(root))[0]?.message).toContain(
      'src/server/routes/health.ts',
    )
    rmSync(join(root, 'public'), { recursive: true })
    expect(() => createSnapshot(root)).toThrow('source root missing: public')
  })

  it('does not read real environment files, secret directories, test code, binaries, or symlinks', () => {
    const root = fixture()
    const before = createSnapshot(root)
    write(root, '.env', 'SECRET=never-read')
    write(root, 'src/.env.production', 'SECRET=never-read')
    write(root, 'deploy/docker/secrets/private.json', 'not-json-secret')
    write(root, 'src/tests/mock.ts', 'throw new Error("not runtime")')
    write(root, 'src/widget.test.ts', 'throw new Error("not runtime")')
    write(root, 'public/icon.png', 'binary')
    write(root, 'src/dist/generated.ts', 'not-runtime')
    symlinkSync(join(root, '.env'), join(root, 'src/private.ts'))
    expect(createSnapshot(root)).toEqual(before)
  })

  it('refuses a dotenv example symlink before reading its real environment target', () => {
    const root = fixture()
    write(root, '.env', 'SECRET=never-read')
    rmSync(join(root, '.env.example'))
    symlinkSync(join(root, '.env'), join(root, '.env.example'))
    expect(() => createSnapshot(root)).toThrow('.env.example must be a regular example file')
  })

  it('normalizes dependency-only and formatting changes in package.json but retains version and commands', () => {
    const root = fixture()
    const before = createSnapshot(root)
    write(
      root,
      'package.json',
      '{\n"dependencies":{"hono":"2.0.0"},"scripts":{"start":"bun src/index.ts"},"version":"1.0.0"\n}',
    )
    expect(createSnapshot(root)).toEqual(before)
    write(root, 'package.json', '{"version":"1.0.0","scripts":{"start":"bun different.ts"}}')
    expect(createSnapshot(root).release.digest).not.toBe(before.release.digest)
  })

  it('tracks the root build configuration and container entrypoint', () => {
    const root = fixture()
    write(root, 'vite.config.ts', 'export default { build: { target: "es2022" } }\n')
    write(root, 'Dockerfile', 'FROM oven/bun:1\n')
    const snapshot = createSnapshot(root)
    expect(Object.hasOwn(snapshot.release.files, 'vite.config.ts')).toBe(true)
    expect(Object.hasOwn(snapshot.deployment.files, 'Dockerfile')).toBe(true)
  })

  it('tracks runtime CSS and markup in the interface domain', () => {
    const root = fixture()
    for (const path of [
      'src/web/index.css',
      'src/web/shell.html',
      'index.html',
      'spotify-embed-bridge.html',
    ]) {
      const before = createSnapshot(root)
      write(root, path, 'body { color: red; }\n')
      expect(createSnapshot(root).interface.digest).not.toBe(before.interface.digest)
    }
  })

  it('ignores version-only action comments and compose minor pins, retaining semantic comments', () => {
    const path = '.github/workflows/ci.yml'
    expect(normalizeSource(path, '- uses: actions/checkout@abc # v6.0.0\n')).toBe(
      normalizeSource(path, '- uses: actions/checkout@def # v6.1.0\r\n'),
    )
    expect(normalizeSource(path, '- uses: actions/checkout@abc # preserve credentials\n')).not.toBe(
      normalizeSource(path, '- uses: actions/checkout@abc\n'),
    )
    const compose = '    #   :1.19 -> current minor release line, patch fixes only\n'
    expect(normalizeSource('deploy/docker/docker-compose.yml', compose)).toBe(
      normalizeSource('deploy/docker/docker-compose.yml', compose.replace(':1.19', ':1.20')),
    )
    expect(normalizeSource('src/core/file.ts', 'const x = 1\r\n')).toBe(
      normalizeSource('src/core/file.ts', 'const x = 1\n'),
    )
  })

  it.each([
    'src/core/auth.ts',
    'src/core/oauth.ts',
    'src/core/sessions.ts',
    'src/server/schemas/auth.ts',
    'src/server/schemas/oauth.ts',
    'src/server/schemas/users.ts',
    'src/server/routes/users.ts',
    'src/server/routes/setup.ts',
    'src/server/routes/admin.ts',
  ])('maps identity-sensitive source %s to authentication', (path) => {
    const root = fixture()
    write(root, path, 'export const identity = true\n')
    expect(Object.hasOwn(createSnapshot(root).authentication.files, path)).toBe(true)
  })

  it.each([
    'deploy/docker/Dockerfile.debian',
    'deploy/service/app.conf',
    'deploy/service/app.toml',
    'deploy/service/app.ini',
    'deploy/helm/digarr/templates/tests/connection.yaml',
  ])('includes deployment source %s', (path) => {
    const root = fixture()
    write(root, path, 'enabled = true\n')
    expect(Object.hasOwn(createSnapshot(root).deployment.files, path)).toBe(true)
  })

  it('normalizes known release pins while retaining action identity, conditions, permissions, and defaults', () => {
    const workflow =
      'permissions: read-all\njobs:\n  build:\n    if: true\n    steps:\n      - uses: actions/checkout@v4\n'
    expect(
      normalizeSource('.github/workflows/ci.yml', workflow.replace('@v4', `@${'a'.repeat(40)}`)),
    ).toBe(normalizeSource('.github/workflows/ci.yml', workflow))
    for (const change of [
      workflow.replace('actions/checkout', 'another/action'),
      workflow.replace('if: true', 'if: false'),
      workflow.replace('read-all', 'write-all'),
    ])
      expect(normalizeSource('.github/workflows/ci.yml', change)).not.toBe(
        normalizeSource('.github/workflows/ci.yml', workflow),
      )
    const values =
      'image:\n  repository: ghcr.io/iuliandita/digarr\n  tag: "1.0.0"\n  digest: "sha256:aaa"\n\nenv:\n  PORT: "3000"\n'
    expect(
      normalizeSource(
        'deploy/helm/digarr/values.yaml',
        values.replace('1.0.0', '1.0.1').replace('sha256:aaa', 'sha256:bbb'),
      ),
    ).toBe(normalizeSource('deploy/helm/digarr/values.yaml', values))
    expect(
      normalizeSource('deploy/helm/digarr/values.yaml', values.replace('3000', '4000')),
    ).not.toBe(normalizeSource('deploy/helm/digarr/values.yaml', values))
    const root = fixture()
    const before = createSnapshot(root)
    const xml = readFileSync(join(root, 'deploy/unraid/digarr.xml'), 'utf8')
    write(root, 'deploy/unraid/digarr.xml', xml.replaceAll('1.0.0', '1.0.1'))
    expect(createSnapshot(root).companions).toEqual(before.companions)
    write(root, 'deploy/unraid/digarr.xml', xml.replace('Default="true"', 'Default="false"'))
    expect(createSnapshot(root).companions).not.toEqual(before.companions)
  })
})

describe('documentation review validation', () => {
  it.each([
    ['configuration', '.env.example', 'PORT=4000\n'],
    ['api', 'src/server/helpers/openapi-doc.ts', 'export const schema = { newRoute: true }\n'],
    [
      'companions',
      'deploy/unraid/digarr.xml',
      '<Container><Config Default="false">false</Config></Container>\n',
    ],
  ] as const)(
    'accepts %s operator specifications without requiring an unrelated Markdown edit',
    (domain, doc, content) => {
      const root = fixture()
      const old = baseline(root)
      write(root, doc, content)
      const snapshot = createSnapshot(root)
      const current = acceptReview(
        root,
        old,
        snapshot,
        domain,
        receipt({
          outcome: 'docs-updated',
          docs: [doc],
          note: impactNote,
          ...(domain === 'companions'
            ? { companions: old.domains.companions.review.companions }
            : {}),
        }),
      )
      expect(
        checkContracts(root, current, snapshot, {
          lock: old,
          changedFiles: [doc],
          lockAdded: false,
        }),
      ).toEqual([])
    },
  )

  it.each(['n/a', 'todo', 'none', 'unchanged', 'No impact.', 'Not applicable.'])(
    'rejects placeholder explanation %s',
    (note) => {
      expect(specificExplanation(note)).toBe(false)
    },
  )

  it('rejects missing, invalid schema, unknown/missing domains, corrupt hashes, digest mismatches, and invalid docs', () => {
    const root = fixture()
    const good = baseline(root)
    const variants: unknown[] = [
      null,
      { ...good, schema: 2 },
      { ...good, domains: { ...good.domains, unexpected: good.domains.api } },
    ]
    const missing = structuredClone(good) as { domains: Partial<typeof good.domains> }
    delete missing.domains.api
    variants.push(missing)
    for (const mutate of [
      (lock: typeof good) => {
        lock.domains.api.files['src/server/routes/health.ts'] = 'bad'
      },
      (lock: typeof good) => {
        lock.domains.api.digest = '0'.repeat(64)
      },
      (lock: typeof good) => {
        lock.domains.api.review.digest = '0'.repeat(64)
      },
      (lock: typeof good) => {
        lock.domains.api.review.docs = ['README.md']
      },
      (lock: typeof good) => {
        lock.domains.api.review.docs = ['missing.md']
      },
    ]) {
      const bad = structuredClone(good)
      mutate(bad)
      variants.push(bad)
    }
    for (const bad of variants) expect(validateLock(root, bad).length).toBeGreaterThan(0)
  })

  it('accepts exactly one domain while preserving other source receipts', () => {
    const root = fixture()
    const lock = baseline(root)
    write(root, 'src/config/env.ts', 'export const port = 4000\n')
    const snapshot = createSnapshot(root)
    const updated = acceptReview(root, lock, snapshot, 'configuration', receipt())
    expect(checkContracts(root, updated, snapshot)).toEqual([])
    expect(updated.domains.api).toBe(lock.domains.api)
    expect(updated.domains.configuration.review.outcome).toBe('no-impact')
  })

  it('accepts ordinary query-only no-impact without migration boilerplate', () => {
    const root = fixture()
    const lock = baseline(root)
    write(root, 'src/db/queries/new-query.ts', 'export const query = "SELECT 1"\n')
    expect(() =>
      acceptReview(root, lock, createSnapshot(root), 'data-recovery', receipt()),
    ).not.toThrow()
  })

  it.each(['src/core/ops/upgrade.ts', 'scripts/rotate-encryption-key.ts', 'src/db/schema.ts'])(
    'requires recovery consequences for %s changes',
    (path) => {
      const root = fixture()
      const lock = baseline(root)
      write(root, path, 'export const changed = true\n')
      expect(() =>
        acceptReview(root, lock, createSnapshot(root), 'data-recovery', receipt()),
      ).toThrow('upgrade, rollback, and backup')
      expect(() =>
        acceptReview(
          root,
          lock,
          createSnapshot(root),
          'data-recovery',
          receipt({ migration: migrationNote }),
        ),
      ).not.toThrow()
    },
  )

  it.each(['drizzle/0001_new.sql', 'drizzle/meta/_journal.json'])(
    'forbids no-impact for changed migration %s and requires all recovery docs',
    (path) => {
      const root = fixture()
      const lock = baseline(root)
      write(
        root,
        path,
        path.endsWith('.sql') ? 'ALTER TABLE users ADD name text;\n' : '{"entries":[0,1]}',
      )
      const snapshot = createSnapshot(root)
      expect(() =>
        acceptReview(root, lock, snapshot, 'data-recovery', receipt({ migration: migrationNote })),
      ).toThrow('cannot use no-impact')
      expect(() =>
        acceptReview(
          root,
          lock,
          snapshot,
          'data-recovery',
          receipt({
            outcome: 'docs-updated',
            docs: ['docs/OPERATIONS.md'],
            note: impactNote,
            migration: migrationNote,
          }),
        ),
      ).toThrow('require CHANGELOG.md')
      const next = acceptReview(
        root,
        lock,
        snapshot,
        'data-recovery',
        receipt({
          outcome: 'docs-updated',
          docs: ['CHANGELOG.md', 'docs/OPERATIONS.md', 'docs/guides/switching-backends.md'],
          note: impactNote,
          migration: migrationNote,
        }),
      )
      expect(checkContracts(root, next, snapshot)).toEqual([])
    },
  )

  it('requires a changelog and human domain guide for breaking changes', () => {
    const root = fixture()
    const lock = baseline(root)
    const snapshot = createSnapshot(root)
    const breaking = 'Existing clients must change their authentication request headers.'
    expect(() => acceptReview(root, lock, snapshot, 'api', receipt({ breaking }))).toThrow(
      'cannot use no-impact',
    )
    expect(() =>
      acceptReview(
        root,
        lock,
        snapshot,
        'api',
        receipt({
          outcome: 'docs-updated',
          docs: ['CHANGELOG.md', 'src/server/helpers/openapi-doc.ts'],
          note: impactNote,
          breaking,
        }),
      ),
    ).toThrow('domain guide')
    expect(() =>
      acceptReview(
        root,
        lock,
        snapshot,
        'api',
        receipt({
          outcome: 'docs-updated',
          docs: ['CHANGELOG.md', 'docs/API.md'],
          note: impactNote,
          breaking,
        }),
      ),
    ).not.toThrow()
  })

  it('requires both companion reviews, specific explanations, and repository-specific PR URLs', () => {
    const root = fixture()
    const lock = baseline(root)
    const snapshot = createSnapshot(root)
    expect(() => acceptReview(root, lock, snapshot, 'companions', receipt())).toThrow(
      'both companion',
    )
    const companions = structuredClone(lock.domains.companions.review.companions ?? [])
    const first = companions[0]
    if (!first) throw new Error('fixture companion missing')
    first.url = 'https://github.com/wrong/repo/pull/4'
    first.status = 'pending'
    expect(() => acceptReview(root, lock, snapshot, 'companions', receipt({ companions }))).toThrow(
      'requires its GitHub',
    )
    for (const companion of companions) {
      companion.status = 'unaffected'
      delete companion.url
      companion.note = 'The unchanged external template already matches this behavior.'
    }
    expect(() =>
      acceptReview(root, lock, snapshot, 'companions', receipt({ companions })),
    ).not.toThrow()
  })
})

describe('breaking companion documentation', () => {
  it('allows a declared breaking companion change with a changelog and its human guide', () => {
    const root = fixture()
    const lock = baseline(root)
    expect(() =>
      acceptReview(
        root,
        lock,
        createSnapshot(root),
        'companions',
        receipt({
          outcome: 'docs-updated',
          docs: ['CHANGELOG.md', 'docs/guides/unraid.md'],
          breaking: 'Operators must migrate the existing application data folder mapping.',
          companions: lock.domains.companions.review.companions,
        }),
      ),
    ).not.toThrow()
  })
})

describe('PR range validation and command interface', () => {
  it('accepts historical source mappings and doc rules without weakening current validation', () => {
    const root = fixture()
    const old = baseline(root)
    const path = 'src/server/routes/health.ts'
    const fingerprint = old.domains.api.files[path]
    if (!fingerprint) throw new Error('missing fixture source')
    delete old.domains.api.files[path]
    old.domains.api.digest = snapshotDigest(old.domains.api.files)
    old.domains.api.review.digest = old.domains.api.digest
    old.domains.features.files[path] = fingerprint
    old.domains.features.digest = snapshotDigest(old.domains.features.files)
    old.domains.features.review.digest = old.domains.features.digest
    old.domains.features.review.docs = ['docs/RETIRED-GUIDE.md']
    const snapshot = createSnapshot(root)
    let current = baseline(root)
    for (const domain of ['api', 'features'] as const)
      current = acceptReview(root, current, snapshot, domain, receipt())
    expect(
      checkContracts(root, current, snapshot, { lock: old, changedFiles: [], lockAdded: false }),
    ).toEqual([])
    expect(validateLock(root, old).length).toBeGreaterThan(0)
    let migrated = acceptReview(root, old, snapshot, 'features', receipt())
    migrated = acceptReview(root, migrated, snapshot, 'api', receipt())
    expect(
      checkContracts(root, migrated, snapshot, { lock: old, changedFiles: [], lockAdded: false }),
    ).toEqual([])
  })

  it('lets the CLI refresh retired doc rules while ordinary checks remain strict', () => {
    const root = fixture()
    const old = baseline(root)
    old.domains.api.review.docs = ['docs/RETIRED-GUIDE.md']
    save(root, old)
    initGit(root)
    expect(cli(root).status).toBe(1)
    expect(
      cli(root, '--accept', 'api', '--no-impact', noImpactNote, '--breaking', 'none').status,
    ).toBe(0)
    expect(cli(root).status).toBe(0)
  })

  it('validates historical base receipts after a formerly reviewed document is deleted', () => {
    const root = fixture()
    const old = baseline(root)
    rmSync(join(root, 'README.md'))
    const current = structuredClone(old)
    for (const domain of DOMAIN_NAMES)
      current.domains[domain].review.docs = current.domains[domain].review.docs.filter(
        (doc) => doc !== 'README.md',
      )
    expect(
      checkContracts(root, current, createSnapshot(root), {
        lock: old,
        changedFiles: ['README.md'],
        lockAdded: false,
      }),
    ).toEqual([])
    expect(validateLock(root, old).length).toBeGreaterThan(0)
  })

  it('rejects manually acknowledged SQL changes as no-impact against the base', () => {
    const root = fixture()
    const old = baseline(root)
    write(root, 'drizzle/0001_new.sql', 'ALTER TABLE users ADD COLUMN name text;\n')
    const snapshot = createSnapshot(root)
    const current = structuredClone(old)
    current.domains['data-recovery'] = {
      ...snapshot['data-recovery'],
      review: {
        ...receipt({ migration: migrationNote }),
        digest: snapshot['data-recovery'].digest,
      },
    }
    expect(
      checkContracts(root, current, snapshot, {
        lock: old,
        changedFiles: [],
        lockAdded: false,
      }).some((finding) => finding.message.includes('cannot use no-impact')),
    ).toBe(true)
  })

  it('requires a combined migration receipt when a later query receipt supersedes it', () => {
    const root = fixture()
    const old = baseline(root)
    write(root, 'drizzle/0001_new.sql', 'ALTER TABLE users ADD COLUMN name text;\n')
    const recoveryDocs = ['CHANGELOG.md', 'docs/OPERATIONS.md', 'docs/guides/switching-backends.md']
    let current = acceptReview(
      root,
      old,
      createSnapshot(root),
      'data-recovery',
      receipt({
        outcome: 'docs-updated',
        docs: recoveryDocs,
        note: impactNote,
        migration: migrationNote,
      }),
    )
    write(root, 'src/db/queries/list.ts', 'export const query = true\n')
    const snapshot = createSnapshot(root)
    current = acceptReview(root, current, snapshot, 'data-recovery', receipt())
    const context = { lock: old, changedFiles: recoveryDocs, lockAdded: false }
    expect(
      checkContracts(root, current, snapshot, context).some((finding) =>
        finding.message.includes('cannot use no-impact'),
      ),
    ).toBe(true)
    current = acceptReview(
      root,
      current,
      snapshot,
      'data-recovery',
      receipt({
        outcome: 'docs-updated',
        docs: recoveryDocs,
        note: 'Reviewed the combined release migration and subsequent query changes.',
        migration: migrationNote,
      }),
    )
    expect(checkContracts(root, current, snapshot, context)).toEqual([])
  })

  it('requires changed cited docs, a new explanation, and non-baseline review after the initial lock', () => {
    const root = fixture()
    const lock = baseline(root)
    write(root, 'src/server/routes/health.ts', 'export const health = false\n')
    const snapshot = createSnapshot(root)
    const next = acceptReview(
      root,
      lock,
      snapshot,
      'api',
      receipt({ outcome: 'docs-updated', docs: ['docs/API.md'], note: impactNote }),
    )
    const context = { lock, changedFiles: ['src/server/routes/health.ts'], lockAdded: false }
    expect(checkContracts(root, next, snapshot, context)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('unchanged in this range') }),
      ]),
    )
    context.changedFiles.push('docs/API.md')
    expect(checkContracts(root, next, snapshot, context)).toEqual([])
    next.domains.api.review.note = lock.domains.api.review.note
    expect(
      checkContracts(root, next, snapshot, context).some((finding) =>
        finding.message.includes('reused'),
      ),
    ).toBe(true)
    next.domains.api.review.outcome = 'baseline'
    expect(
      checkContracts(root, next, snapshot, context).some((finding) =>
        finding.message.includes('initial lock'),
      ),
    ).toBe(true)
  })

  it('rejects a reused no-impact explanation from the base', () => {
    const root = fixture()
    let lock = baseline(root)
    lock = acceptReview(root, lock, createSnapshot(root), 'configuration', receipt())
    write(root, 'src/config/env.ts', 'export const port = 4000\n')
    const snapshot = createSnapshot(root)
    const next = acceptReview(root, lock, snapshot, 'configuration', receipt())
    expect(
      checkContracts(root, next, snapshot, { lock, changedFiles: [], lockAdded: false }).some(
        (finding) => finding.message.includes('reused'),
      ),
    ).toBe(true)
  })

  it('uses argument-safe valid commit SHAs and includes only tracked/staged local changes', () => {
    const root = fixture()
    save(root, baseline(root))
    const sha = initGit(root)
    write(root, 'docs/API.md', 'Changed the API operator guide.\n')
    write(root, 'src/server/new-handler.ts', 'export const route = true\n')
    write(root, 'scripts/private-scratch.py', 'private_data = "never-read"\n')
    git(root, 'add', 'src/server/new-handler.ts')
    const context = readBaseContext(root, sha.slice(0, 10))
    expect(context.changedFiles).toContain('docs/API.md')
    expect(context.changedFiles).toContain('src/server/new-handler.ts')
    expect(context.changedFiles).not.toContain('scripts/private-scratch.py')
    expect(context.lock).not.toBeNull()
    for (const malicious of [
      '',
      'HEAD',
      '--help',
      'abcdefg',
      '1234567; touch file',
      '0'.repeat(40),
    ])
      expect(() => readBaseContext(root, malicious)).toThrow()
    expect(cli(root, '--base').status).toBe(1)
  })

  it('allows initial bootstrap only when the range actually adds the lock', () => {
    const root = fixture()
    const sha = initGit(root)
    const lock = baseline(root)
    save(root, lock)
    const snapshot = createSnapshot(root)
    expect(readBaseContext(root, sha).lockAdded).toBe(false)
    git(root, 'add', LOCK_PATH)
    const context = readBaseContext(root, sha)
    expect(context.lockAdded).toBe(true)
    expect(checkContracts(root, lock, snapshot, context)).toEqual([])
    expect(
      checkContracts(root, lock, snapshot, { ...context, lockAdded: false })[0]?.message,
    ).toContain('bootstrap')
  })

  it('initializes once, reports stale files, accepts explicit reviews, and fails closed for bad lock/flags', () => {
    const root = fixture()
    initGit(root)
    const companionArgs = COMPANION_REPOS.flatMap((repo) => [
      '--companion',
      `${repo}|unaffected||Synthetic fixture has no external companion changes to review.`,
    ])
    expect(cli(root).status).toBe(1)
    expect(cli(root, '--init', '--note', initialNote).status).toBe(1)
    expect(cli(root, '--init', '--note', initialNote, ...companionArgs).status).toBe(0)
    expect(cli(root, '--init', '--note', initialNote).status).toBe(1)
    expect(cli(root).status).toBe(0)
    write(root, 'src/config/env.ts', 'export const port = 4000\n')
    const stale = cli(root, '--explain', 'configuration')
    expect(stale.status).toBe(1)
    expect(stale.stdout).toContain('src/config/env.ts')
    expect(cli(root, '--accept', 'configuration', '--no-impact', noImpactNote).status).toBe(1)
    expect(
      cli(root, '--accept', 'configuration', '--no-impact', noImpactNote, '--breaking', 'none')
        .status,
    ).toBe(0)
    expect(cli(root).status).toBe(0)
    expect(cli(root, '--unknown').status).toBe(1)
    write(root, LOCK_PATH, '{bad json')
    expect(cli(root).status).toBe(1)
  })
})
