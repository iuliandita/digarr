import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'

export const LOCK_PATH = 'docs/contracts.lock.json'
export const COMPANION_REPOS = [
  'iuliandita/unraid-templates',
  'selfhosters/unRAID-CA-templates',
] as const
export const DOMAINS = {
  companions: {
    allowedDocs: ['docs/guides/unraid.md', 'deploy/unraid/digarr.xml', 'CHANGELOG.md'],
  },
  'data-recovery': {
    allowedDocs: [
      'docs/OPERATIONS.md',
      'docs/guides/switching-backends.md',
      'docs/runbooks/encryption-key-rotation.md',
      'docs/API.md',
      'CHANGELOG.md',
    ],
  },
  configuration: {
    allowedDocs: [
      '.env.example',
      'deploy/docker/.env.example',
      'docs/OPERATIONS.md',
      'docs/AUTHENTICATION.md',
      'CHANGELOG.md',
    ],
  },
  authentication: {
    allowedDocs: [
      'docs/AUTHENTICATION.md',
      'docs/API.md',
      'SECURITY.md',
      'docs/OPERATIONS.md',
      'CHANGELOG.md',
    ],
  },
  api: {
    allowedDocs: [
      'docs/API.md',
      'src/server/helpers/openapi-doc.ts',
      'docs/OPERATIONS.md',
      'CHANGELOG.md',
    ],
  },
  interface: {
    allowedDocs: [
      'docs/SCREENSHOTS.md',
      'README.md',
      'docs/OPERATIONS.md',
      'CONTRIBUTING.md',
      'CHANGELOG.md',
    ],
  },
  features: {
    allowedDocs: [
      'README.md',
      'docs/ARCHITECTURE.md',
      'docs/OPERATIONS.md',
      'docs/API.md',
      'docs/RECOMMENDATION-QUALITY.md',
      'CHANGELOG.md',
    ],
  },
  deployment: {
    allowedDocs: [
      'deploy/docker/README.md',
      'deploy/helm/digarr/README.md',
      'docs/guides/docker-desktop.md',
      'docs/guides/synology.md',
      'docs/guides/unraid.md',
      'docs/ARCHITECTURE.md',
      'docs/OPERATIONS.md',
      'CHANGELOG.md',
    ],
  },
  release: {
    allowedDocs: [
      'CHANGELOG.md',
      'docs/ROADMAP.md',
      'README.md',
      'deploy/docker/README.md',
      'deploy/helm/digarr/README.md',
      'docs/ARCHITECTURE.md',
      'docs/OPERATIONS.md',
    ],
  },
  maintenance: { allowedDocs: ['CONTRIBUTING.md', 'docs/MAINTENANCE.md', 'CHANGELOG.md'] },
} as const

export type Domain = keyof typeof DOMAINS
export type Snapshot = { files: Record<string, string>; digest: string }
export type Snapshots = Record<Domain, Snapshot>
export type CompanionReview = {
  repo: string
  status: 'updated' | 'pending' | 'unaffected'
  url?: string
  note: string
}
export type Review = {
  digest: string
  outcome: 'baseline' | 'docs-updated' | 'no-impact'
  docs: string[]
  note: string
  breaking: string
  migration: string
  companions?: CompanionReview[]
}
export type Contract = Snapshot & { review: Review }
export type ContractsLock = { schema: 1; domains: Record<Domain, Contract> }
export type BaseContext = { lock: unknown | null; changedFiles: string[]; lockAdded: boolean }
export type Finding = { domain?: Domain; message: string }
export const DOMAIN_NAMES = Object.keys(DOMAINS) as Domain[]
const ROOTS = ['src', 'drizzle', 'deploy', 'scripts', 'public', '.github/workflows']
const HASH = /^[a-f0-9]{64}$/
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.css',
  '.html',
  '.js',
  '.mjs',
  '.json',
  '.yaml',
  '.yml',
  '.sh',
  '.py',
  '.conf',
  '.toml',
  '.ini',
])

export function isDomain(value: string): value is Domain {
  return Object.hasOwn(DOMAINS, value)
}
export function domainForPath(path: string): Domain | null {
  if (path === 'deploy/unraid/digarr.xml') return 'companions'
  if (
    /^(src\/core\/ops\/|src\/db\/|drizzle\/)/.test(path) ||
    /^scripts\/(rotate-encryption-key|rotation-sites|prepare-rollback-backup)\.ts$/.test(path)
  )
    return 'data-recovery'
  if (path.startsWith('src/config/') || path === '.env.example') return 'configuration'
  if (
    path.startsWith('src/core/auth/') ||
    ['auth', 'oauth', 'sessions', 'crypto', 'provider-auth'].some(
      (name) => path === `src/core/${name}.ts`,
    ) ||
    path.startsWith('src/server/middleware/') ||
    /^src\/server\/(routes|helpers|schemas)\/[^/]*(auth|oauth|oidc)[^/]*\.(ts|tsx)$/.test(path) ||
    /^src\/server\/(routes|schemas)\/(users|setup|admin)\.(ts|tsx)$/.test(path)
  )
    return 'authentication'
  if (path.startsWith('src/server/')) return 'api'
  if (/^(src\/web\/|src\/core\/i18n\/|public\/)/.test(path)) return 'interface'
  if (path.startsWith('src/')) return 'features'
  if (path.startsWith('deploy/')) return 'deployment'
  if (path.startsWith('.github/workflows/') || path === 'package.json') return 'release'
  if (path.startsWith('scripts/')) return 'maintenance'
  return null
}
function sortedObject<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')))
}
export function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
export function snapshotDigest(files: Record<string, string>): string {
  return hash(JSON.stringify(sortedObject(files)))
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeSource(path: string, content: string): string {
  if (path === 'package.json') {
    const pkg: unknown = JSON.parse(content)
    if (!isRecord(pkg) || typeof pkg.version !== 'string' || !isRecord(pkg.scripts))
      throw new Error('package.json must contain version and scripts')
    return JSON.stringify({ version: pkg.version, scripts: sortedObject(pkg.scripts) })
  }
  let normalized = content.replace(/\r\n/g, '\n')
  if (path.startsWith('.github/workflows/'))
    normalized = normalized
      .replace(/(^[ \t]*(?:-\s*)?uses:\s*["']?)([\w.-]+\/[\w./-]+)@[^\s"'#]+/gm, '$1$2@<pin>')
      .replace(/(@<pin>["']?)[ \t]+# v?\d+(?:\.\d+){0,2}[ \t]*$/gm, '$1')
  if (path.startsWith('deploy/') || path.startsWith('.github/workflows/'))
    normalized = normalized.replace(
      /((?:ghcr\.io|docker\.io)\/iuliandita\/digarr)(?:@sha256:[a-f0-9]{64}|:\d+\.\d+(?:\.\d+)?(?:-debian|-alpine)?)/g,
      '$1:<pin>',
    )
  if (path.startsWith('deploy/docker/'))
    normalized = normalized.replace(
      /^([ \t]*#\s+):\d+\.\d+(\s+-> current minor release line[^\n]*)$/gm,
      '$1:<pin>$2',
    )
  if (path === 'deploy/helm/digarr/Chart.yaml')
    normalized = normalized.replace(/^(version|appVersion):[^\n]*$/gm, '$1: <pin>')
  if (path === 'deploy/helm/digarr/values.yaml')
    normalized = normalized.replace(/(^image:\n(?:(?:[ \t]+[^\n]*|)\n)*?)(?=\S|$)/m, (block) =>
      block.replace(/^( {2}(?:tag|digest):)[^\n]*$/gm, '$1 <pin>'),
    )
  if (path === 'deploy/k8s/rendered.yaml')
    normalized = normalized
      .replace(/(helm\.sh\/chart: digarr-)\d+\.\d+\.\d+/g, '$1<pin>')
      .replace(/(app\.kubernetes\.io\/version: )"?\d+\.\d+\.\d+"?/g, '$1<pin>')
  if (path === 'deploy/unraid/digarr.xml')
    normalized = normalized
      .replace(/<(Tag|TagDescription)>[^<]*<\/\1>/g, '<$1><pin></$1>')
      .replace(
        /(Digest pin \(synced via scripts\/sync-deploy-digests\.ts\): )sha256:[a-f0-9]{64}/g,
        '$1<pin>',
      )
  return normalized
}
function isSource(path: string): boolean {
  const name = basename(path)
  if (name.startsWith('.env')) return name === '.env.example'
  if (
    name === 'Dockerfile' ||
    name.startsWith('Dockerfile.') ||
    path === 'deploy/unraid/digarr.xml'
  )
    return true
  if (path.startsWith('drizzle/') && extname(path) === '.sql') return true
  if (path.startsWith('deploy/helm/') && ['.tpl', '.txt'].includes(extname(path))) return true
  return SOURCE_EXTENSIONS.has(extname(path))
}
function eligibleSource(path: string): boolean {
  return (
    isSource(path) &&
    !path
      .split('/')
      .slice(0, -1)
      .some(
        (part) =>
          ['node_modules', 'secrets', '.git'].includes(part) ||
          (path.startsWith('src/') && ['dist', 'tests', '__tests__', 'coverage'].includes(part)) ||
          (part.startsWith('.') && part !== '.github'),
      ) &&
    !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
  )
}
function gitInventory(root: string): string[] | null {
  let ancestor = resolve(root)
  while (!existsSync(join(ancestor, '.git'))) {
    const parent = dirname(ancestor)
    if (parent === ancestor) return null
    ancestor = parent
  }
  if (ancestor !== resolve(root)) throw new Error('snapshot root must be the Git repository root')
  return execFileSync('git', ['ls-files', '--cached', '-z'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\0')
    .filter(Boolean)
}
function inventory(root: string, path: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const relative = `${path}/${entry.name}`
    if (entry.isDirectory()) {
      if (
        ['node_modules', 'secrets', '.git'].includes(entry.name) ||
        (relative.startsWith('src/') &&
          ['dist', 'tests', '__tests__', 'coverage'].includes(entry.name)) ||
        entry.name.startsWith('.')
      )
        continue
      result.push(...inventory(root, relative))
    } else if (
      entry.isFile() &&
      isSource(relative) &&
      !/\.(test|spec)\.[cm]?[jt]sx?$/.test(relative)
    )
      result.push(relative)
  }
  return result
}
export function createSnapshot(root: string, options: { allowNonGit?: boolean } = {}): Snapshots {
  const tracked = gitInventory(root)
  if (tracked === null && !options.allowNonGit)
    throw new Error(
      'source snapshot requires Git; filesystem inventory is available only with explicit allowNonGit for synthetic fixtures',
    )
  const files = ['package.json']
  if (tracked && !tracked.includes('package.json'))
    throw new Error('package.json must be Git-tracked')
  if (!lstatSync(join(root, 'package.json')).isFile())
    throw new Error('package.json must be a regular source file')
  for (const sourceRoot of ROOTS) {
    if (!existsSync(join(root, sourceRoot))) throw new Error(`source root missing: ${sourceRoot}`)
    if (!lstatSync(join(root, sourceRoot)).isDirectory())
      throw new Error(`source root must be a real directory: ${sourceRoot}`)
    const sources = tracked
      ? tracked.filter(
          (path) =>
            path.startsWith(`${sourceRoot}/`) &&
            eligibleSource(path) &&
            existsSync(join(root, path)) &&
            lstatSync(join(root, path)).isFile(),
        )
      : inventory(root, sourceRoot)
    if (!sources.length) throw new Error(`source root has no source files: ${sourceRoot}`)
    files.push(...sources)
  }
  if (
    (tracked === null || tracked.includes('.env.example')) &&
    existsSync(join(root, '.env.example'))
  ) {
    if (!lstatSync(join(root, '.env.example')).isFile())
      throw new Error('.env.example must be a regular example file')
    files.push('.env.example')
  }
  const snapshots = Object.fromEntries(
    DOMAIN_NAMES.map((domain) => [domain, { files: {}, digest: '' }]),
  ) as Snapshots
  for (const path of files.sort()) {
    const domain = domainForPath(path)
    if (!domain) throw new Error(`source file has no domain: ${path}`)
    snapshots[domain].files[path] = hash(
      normalizeSource(path, readFileSync(join(root, path), 'utf8')),
    )
  }
  for (const domain of DOMAIN_NAMES) {
    if (!Object.keys(snapshots[domain].files).length)
      throw new Error(`source domain has no source files: ${domain}`)
    snapshots[domain].digest = snapshotDigest(snapshots[domain].files)
  }
  return snapshots
}
export function specificExplanation(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= 20 &&
    value.trim().split(/\s+/).length >= 4 &&
    !/^(n\/?a|todo|none|unchanged|no impact|not applicable)[.!\s]*$/i.test(value.trim())
  )
}
function validDoc(root: string, domain: Domain, path: string): boolean {
  return (
    (DOMAINS[domain].allowedDocs as readonly string[]).includes(path) &&
    existsSync(join(root, path)) &&
    statSync(join(root, path)).isFile()
  )
}
function guideDoc(path: string): boolean {
  return path.endsWith('.md') && path !== 'CHANGELOG.md' && path !== 'docs/ROADMAP.md'
}
export function changedSources(before: Snapshot | undefined, after: Snapshot): string[] {
  return [...new Set([...Object.keys(before?.files ?? {}), ...Object.keys(after.files)])]
    .filter((path) => before?.files[path] !== after.files[path])
    .sort()
}
function migrationChanged(before: Snapshot | undefined, after: Snapshot): boolean {
  return changedSources(before, after).some(
    (path) =>
      path.startsWith('drizzle/') && (path.endsWith('.sql') || path.endsWith('/_journal.json')),
  )
}
function recoveryChanged(before: Snapshot, after: Snapshot): boolean {
  return (
    changedSources(before, after).some(
      (path) =>
        path === 'src/db/schema.ts' ||
        path.startsWith('src/core/ops/') ||
        /^scripts\/(rotate-encryption-key|rotation-sites|prepare-rollback-backup)\.ts$/.test(path),
    ) || migrationChanged(before, after)
  )
}
function migrationExplanation(value: string): boolean {
  return (
    specificExplanation(value) &&
    /\bupgrad(?:e|es|ing)\b/i.test(value) &&
    /\brollback\b/i.test(value) &&
    /\bbackup(?:s)?\b/i.test(value)
  )
}
function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').some((part) => part === '..' || part === '.' || part.length === 0)
  )
}

export function validateLock(
  root: string,
  value: unknown,
  options: { historical?: boolean } = {},
): Finding[] {
  const findings: Finding[] = []
  if (!isRecord(value) || value.schema !== 1 || !isRecord(value.domains))
    return [
      {
        message:
          'missing or invalid contract lock (expected schema 1); initialize the first baseline or restore the lock',
      },
    ]
  for (const key of Object.keys(value.domains))
    if (!isDomain(key)) findings.push({ message: `unknown domain: ${key}` })
  for (const domain of DOMAIN_NAMES) {
    const contract = value.domains[domain]
    const fail = (message: string) => findings.push({ domain, message })
    if (!isRecord(contract) || !isRecord(contract.files) || !isRecord(contract.review)) {
      fail('missing or malformed snapshot/review')
      continue
    }
    if (!Object.keys(contract.files).length) fail('snapshot files cannot be empty')
    for (const [path, fingerprint] of Object.entries(contract.files))
      if (
        (!options.historical && (domainForPath(path) !== domain || !isSource(path))) ||
        !safeRelativePath(path) ||
        path.split('/').some((part) => part === '..' || part === 'secrets') ||
        path.startsWith('/') ||
        typeof fingerprint !== 'string' ||
        !HASH.test(fingerprint)
      )
        fail(`invalid source fingerprint: ${path}`)
    if (
      typeof contract.digest !== 'string' ||
      !HASH.test(contract.digest) ||
      contract.digest !== snapshotDigest(contract.files as Record<string, string>)
    )
      fail('snapshot digest does not match files')
    const review = contract.review
    if (!['baseline', 'docs-updated', 'no-impact'].includes(String(review.outcome)))
      fail('unknown review outcome')
    if (review.digest !== contract.digest) fail('review digest does not match snapshot')
    if (
      typeof review.note !== 'string' ||
      (!options.historical && !specificExplanation(review.note))
    )
      fail('review note must explain the decision in at least 20 characters and four words')
    if (
      !Array.isArray(review.docs) ||
      review.docs.some(
        (doc) =>
          typeof doc !== 'string' ||
          !safeRelativePath(doc) ||
          (!options.historical && !validDoc(root, domain, doc)),
      )
    )
      fail('review docs must exist and belong to the domain allowedDocs')
    const docs = Array.isArray(review.docs)
      ? review.docs.filter((doc): doc is string => typeof doc === 'string')
      : []
    if (review.outcome === 'docs-updated' && !docs.length)
      fail('docs-updated requires at least one reviewed document')
    if (
      typeof review.breaking !== 'string' ||
      (!options.historical && review.breaking !== 'none' && !specificExplanation(review.breaking))
    )
      fail('breaking must be none or a specific explanation')
    if (!options.historical && review.breaking !== 'none') {
      if (review.outcome === 'no-impact') fail('a breaking change cannot use no-impact')
      if (!docs.includes('CHANGELOG.md') || !docs.some(guideDoc))
        fail('breaking changes require CHANGELOG.md and a domain guide')
    }
    if (typeof review.migration !== 'string') fail('migration must be a string')
    if (
      review.companions !== undefined &&
      (!Array.isArray(review.companions) ||
        review.companions.some(
          (entry: unknown) =>
            !isRecord(entry) ||
            typeof entry.repo !== 'string' ||
            typeof entry.note !== 'string' ||
            !['updated', 'pending', 'unaffected'].includes(String(entry.status)) ||
            (entry.url !== undefined && typeof entry.url !== 'string'),
        ))
    )
      fail(
        'companion receipts must contain repository, status, explanation, and optional URL strings',
      )
    if (!options.historical && review.migration !== '' && !specificExplanation(review.migration))
      fail('migration must be empty or a specific explanation')
    if (domain === 'companions' && !options.historical) {
      if (!Array.isArray(review.companions) || review.companions.length !== COMPANION_REPOS.length)
        fail('both companion repositories require explicit review statuses')
      for (const repo of COMPANION_REPOS) {
        const matches = Array.isArray(review.companions)
          ? review.companions.filter((entry: unknown) => isRecord(entry) && entry.repo === repo)
          : []
        const companion: unknown = matches[0]
        if (
          matches.length !== 1 ||
          !isRecord(companion) ||
          !['updated', 'pending', 'unaffected'].includes(String(companion.status)) ||
          !specificExplanation(companion.note)
        ) {
          fail(`invalid companion status or explanation: ${repo}`)
          continue
        }
        if (
          companion.status !== 'unaffected' &&
          (typeof companion.url !== 'string' ||
            !new RegExp(`^https://github\\.com/${repo}/pull/[1-9][0-9]*$`).test(companion.url))
        )
          fail(`companion ${repo} requires its GitHub pull request URL`)
      }
    }
  }
  return findings
}
export function checkContracts(
  root: string,
  value: unknown,
  snapshots: Snapshots,
  base?: BaseContext,
): Finding[] {
  const findings = validateLock(root, value)
  if (findings.length) return findings
  const lock = value as ContractsLock
  for (const domain of DOMAIN_NAMES) {
    const changes = changedSources(lock.domains[domain], snapshots[domain])
    if (changes.length)
      findings.push({
        domain,
        message: `source changed: ${changes.join(', ')}; review and accept this domain`,
      })
  }
  if (!base) return findings
  if (base.lock === null) {
    if (!base.lockAdded)
      findings.push({
        message: 'base lock missing; bootstrap is allowed only when this range adds the lock',
      })
    return findings
  }
  const baseFindings = validateLock(root, base.lock, { historical: true })
  if (baseFindings.length)
    return [
      ...findings,
      ...baseFindings.map((finding) => ({ ...finding, message: `base lock: ${finding.message}` })),
    ]
  const baseLock = base.lock as ContractsLock
  for (const domain of DOMAIN_NAMES) {
    const before = baseLock.domains[domain],
      after = lock.domains[domain]
    if (before.digest === after.digest) continue
    const review = after.review
    const fail = (message: string) => findings.push({ domain, message })
    if (review.outcome === 'baseline') fail('baseline is only allowed for the initial lock')
    if (review.note.trim() === before.review.note.trim())
      fail('changed source requires a new review explanation; the base note was reused')
    if (review.outcome === 'docs-updated')
      for (const doc of review.docs)
        if (!base.changedFiles.includes(doc))
          fail(`reviewed document is unchanged in this range: ${doc}`)
    if (
      domain === 'data-recovery' &&
      recoveryChanged(before, after) &&
      !migrationExplanation(review.migration)
    )
      fail(
        'recovery changes require migration to explain upgrade, rollback, and backup consequences',
      )
    if (domain === 'data-recovery' && migrationChanged(before, after)) {
      if (review.outcome !== 'docs-updated')
        fail('SQL/journal changes cannot use no-impact or baseline')
      for (const doc of ['CHANGELOG.md', 'docs/OPERATIONS.md', 'docs/guides/switching-backends.md'])
        if (!review.docs.includes(doc)) fail(`SQL/journal changes require ${doc}`)
    }
  }
  return findings
}
export function createBaseline(
  root: string,
  snapshots: Snapshots,
  note: string,
  companions: CompanionReview[],
): ContractsLock {
  if (!specificExplanation(note))
    throw new Error('baseline note requires at least 20 characters and four words')
  const domains = Object.fromEntries(
    DOMAIN_NAMES.map((domain) => [
      domain,
      {
        ...snapshots[domain],
        review: {
          digest: snapshots[domain].digest,
          outcome: 'baseline' as const,
          docs: DOMAINS[domain].allowedDocs.filter((doc) => validDoc(root, domain, doc)),
          note,
          breaking: 'none',
          migration:
            domain === 'data-recovery'
              ? 'Initial baseline records existing upgrade, rollback, and backup consequences.'
              : '',
          ...(domain === 'companions'
            ? {
                companions,
              }
            : {}),
        },
      },
    ]),
  ) as Record<Domain, Contract>
  const lock: ContractsLock = { schema: 1, domains }
  const findings = validateLock(root, lock)
  if (findings.length) throw new Error(findings.map((finding) => finding.message).join('\n'))
  return lock
}
export function acceptReview(
  root: string,
  lock: ContractsLock,
  snapshots: Snapshots,
  domain: Domain,
  review: Omit<Review, 'digest'>,
): ContractsLock {
  if (review.outcome === 'baseline')
    throw new Error('baseline is only allowed when initializing the first lock')
  const next: ContractsLock = {
    ...lock,
    domains: {
      ...lock.domains,
      [domain]: { ...snapshots[domain], review: { ...review, digest: snapshots[domain].digest } },
    },
  }
  const findings = [
    ...validateLock(root, next, { historical: true }),
    ...validateLock(root, next).filter((finding) => finding.domain === domain),
  ]
  if (
    domain === 'data-recovery' &&
    recoveryChanged(lock.domains[domain], snapshots[domain]) &&
    !migrationExplanation(review.migration)
  )
    findings.push({
      domain,
      message:
        'recovery changes require migration to explain upgrade, rollback, and backup consequences',
    })
  if (domain === 'data-recovery' && migrationChanged(lock.domains[domain], snapshots[domain])) {
    if (review.outcome !== 'docs-updated')
      findings.push({ domain, message: 'SQL/journal changes cannot use no-impact' })
    for (const doc of ['CHANGELOG.md', 'docs/OPERATIONS.md', 'docs/guides/switching-backends.md'])
      if (!review.docs.includes(doc))
        findings.push({ domain, message: `SQL/journal changes require ${doc}` })
  }
  if (findings.length)
    throw new Error(
      findings.map((finding) => `${finding.domain ?? 'lock'}: ${finding.message}`).join('\n'),
    )
  return next
}
export function readBaseContext(root: string, sha: string): BaseContext {
  if (!/^[a-f0-9]{7,40}$/i.test(sha))
    throw new Error('--base must be a full or short hexadecimal commit SHA')
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  try {
    const commit = git(['rev-parse', '--verify', `${sha}^{commit}`])
    const mergeBase = git(['merge-base', commit, 'HEAD'])
    const committed = git(['diff', '--name-only', '-z', `${mergeBase}...HEAD`, '--'])
      .split('\0')
      .filter(Boolean)
    const working = git(['diff', '--name-only', '-z', 'HEAD', '--']).split('\0').filter(Boolean)
    const changedFiles = [...new Set([...committed, ...working])].sort()
    const basePaths = git(['ls-tree', '--name-only', mergeBase, '--', LOCK_PATH])
    const lock: unknown | null = basePaths
      ? JSON.parse(git(['show', `${mergeBase}:${LOCK_PATH}`]))
      : null
    return {
      lock,
      changedFiles,
      lockAdded:
        lock === null && changedFiles.includes(LOCK_PATH) && existsSync(join(root, LOCK_PATH)),
    }
  } catch (error) {
    throw new Error(
      `cannot resolve --base or read its contract lock: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
