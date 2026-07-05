#!/usr/bin/env bun
/**
 * Guard against version-string drift across the repo.
 *
 * Two classes of version surfaces, with different freshness rules:
 *
 * Class A - "release commit" surfaces. Bumped together in the
 * `chore(release): vX.Y.Z` commit and must ALWAYS equal package.json:
 *   - CHANGELOG.md            (top `## vX.Y.Z` heading)
 *   - deploy/helm/digarr/Chart.yaml (version + appVersion; regen rendered.yaml
 *                              via scripts/k8s-sync.sh after bumping)
 *   - docs/ROADMAP.md         (`Current: vX.Y.Z` header)
 *   - README.md               (`**vX.Y.Z is out.**` banner note)
 *
 * Class B - "published image" pins. Rewritten by scripts/sync-deploy-digests.ts
 * AFTER the image publishes, so they legitimately lag class A between the
 * version bump and the digest-sync commit. They must all agree with each
 * other and never exceed class A:
 *   - deploy/helm/digarr/values.yaml   (image tag)
 *   - deploy/unraid/digarr.xml         (<Repository> tag + <Tag>)
 *   - deploy/docker/docker-compose*.yml (example pin comments, incl. -debian
 *                                        and the minor-line pin)
 *   - README.md                        (example minor/patch pins)
 *
 * Digest pins across deployment.yaml / values.yaml / rendered.yaml / the
 * Unraid XML comment must also be identical (same rule as the release
 * workflow's verify-digest-sync job, enforced here on every PR).
 *
 * Exits 1 with a per-finding list on any violation.
 */

import { readFileSync } from 'node:fs'

type Finding = { file: string; message: string }
const findings: Finding[] = []

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function capture(path: string, content: string, pattern: RegExp, label: string): string | null {
  const m = content.match(pattern)
  if (!m?.[1]) {
    findings.push({ file: path, message: `could not locate ${label} (pattern drift?)` })
    return null
  }
  return m[1]
}

function semverParts(v: string): [number, number, number] {
  const [maj = 0, min = 0, pat = 0] = v.split('.').map(Number)
  return [maj, min, pat]
}

function semverGt(a: string, b: string): boolean {
  const [a1, a2, a3] = semverParts(a)
  const [b1, b2, b3] = semverParts(b)
  if (a1 !== b1) return a1 > b1
  if (a2 !== b2) return a2 > b2
  return a3 > b3
}

const pkgVersion = (JSON.parse(read('package.json')) as { version: string }).version

// --- Class A: must equal package.json ---------------------------------------

const classA: Array<{ path: string; pattern: RegExp; label: string }> = [
  { path: 'CHANGELOG.md', pattern: /^## v(\d+\.\d+\.\d+)/m, label: 'top release heading' },
  {
    path: 'deploy/helm/digarr/Chart.yaml',
    pattern: /^version: (\d+\.\d+\.\d+)$/m,
    label: 'chart version',
  },
  {
    path: 'deploy/helm/digarr/Chart.yaml',
    pattern: /^appVersion: "(\d+\.\d+\.\d+)"$/m,
    label: 'chart appVersion',
  },
  {
    path: 'docs/ROADMAP.md',
    pattern: /Current: v(\d+\.\d+\.\d+)/,
    label: 'roadmap Current header',
  },
  {
    path: 'README.md',
    pattern: /\*\*v(\d+\.\d+\.\d+) is out\.\*\*/,
    label: 'release banner note',
  },
]

for (const t of classA) {
  const found = capture(t.path, read(t.path), t.pattern, t.label)
  if (found && found !== pkgVersion) {
    findings.push({
      file: t.path,
      message: `${t.label} is v${found}, package.json is v${pkgVersion} - bump it in the release commit`,
    })
  }
}

// --- Class B: image pins must agree with each other, never exceed A ---------

const classBPatch: Array<{ path: string; pattern: RegExp; label: string }> = [
  {
    path: 'deploy/helm/digarr/values.yaml',
    pattern: /^ {2}tag: "(\d+\.\d+\.\d+)"$/m,
    label: 'helm image tag',
  },
  {
    path: 'deploy/unraid/digarr.xml',
    pattern: /<Repository>docker\.io\/iuliandita\/digarr:(\d+\.\d+\.\d+)<\/Repository>/,
    label: 'unraid Repository tag',
  },
  {
    path: 'deploy/unraid/digarr.xml',
    pattern: /<Tag>(\d+\.\d+\.\d+)<\/Tag>/,
    label: 'unraid Tag',
  },
  {
    path: 'deploy/docker/docker-compose.yml',
    pattern: /# image: docker\.io\/iuliandita\/digarr:(\d+\.\d+\.\d+)\n/,
    label: 'compose patch pin',
  },
  {
    path: 'deploy/docker/docker-compose.yml',
    pattern: /# image: docker\.io\/iuliandita\/digarr:(\d+\.\d+\.\d+)-debian/,
    label: 'compose debian pin',
  },
  {
    path: 'deploy/docker/docker-compose.pglite.yml',
    pattern: /surprises: docker\.io\/iuliandita\/digarr:(\d+\.\d+\.\d+)/,
    label: 'pglite compose patch pin',
  },
  {
    path: 'deploy/docker/docker-compose.pglite.yml',
    pattern: /variant: docker\.io\/iuliandita\/digarr:(\d+\.\d+\.\d+)-debian/,
    label: 'pglite compose debian pin',
  },
  {
    path: 'README.md',
    pattern: /specific patch like `:(\d+\.\d+\.\d+)`/,
    label: 'README patch pin example',
  },
]

const classBMinor: Array<{ path: string; pattern: RegExp; label: string }> = [
  {
    path: 'deploy/docker/docker-compose.yml',
    pattern: /# {3}:(\d+\.\d+) -> current minor release line/,
    label: 'compose minor channel comment',
  },
  {
    path: 'deploy/docker/docker-compose.pglite.yml',
    pattern: /Track patch fixes only: docker\.io\/iuliandita\/digarr:(\d+\.\d+)\n/,
    label: 'pglite compose minor pin',
  },
  {
    path: 'README.md',
    pattern: /minor tag like `:(\d+\.\d+)`/,
    label: 'README minor pin example',
  },
]

const patchValues = new Map<string, string>()
for (const t of classBPatch) {
  const found = capture(t.path, read(t.path), t.pattern, t.label)
  if (found) patchValues.set(`${t.path} (${t.label})`, found)
}

const distinctPatch = new Set(patchValues.values())
if (distinctPatch.size > 1) {
  const detail = [...patchValues.entries()].map(([k, v]) => `${k}=v${v}`).join(', ')
  findings.push({
    file: 'deploy/*',
    message: `published-image pins disagree: ${detail} - run \`bun scripts/sync-deploy-digests.ts v<tag>\``,
  })
}

const pinned = [...distinctPatch][0]
if (pinned && semverGt(pinned, pkgVersion)) {
  findings.push({
    file: 'package.json',
    message: `image pins are v${pinned} but package.json is v${pkgVersion} - version bump missing?`,
  })
}

const expectedMinor = pinned ? pinned.split('.').slice(0, 2).join('.') : null
for (const t of classBMinor) {
  const found = capture(t.path, read(t.path), t.pattern, t.label)
  if (found && expectedMinor && found !== expectedMinor) {
    findings.push({
      file: t.path,
      message: `${t.label} is :${found}, expected :${expectedMinor} (from patch pins v${pinned})`,
    })
  }
}

// --- Digest pins must be identical across all four deploy files -------------

const digestTargets: Array<{ path: string; pattern: RegExp; label: string }> = [
  {
    path: 'deploy/k8s/deployment.yaml',
    pattern: /ghcr\.io\/iuliandita\/digarr@(sha256:[a-f0-9]{64})/,
    label: 'k8s digest',
  },
  {
    path: 'deploy/helm/digarr/values.yaml',
    pattern: /digest: "(sha256:[a-f0-9]{64})"/,
    label: 'helm digest',
  },
  {
    path: 'deploy/k8s/rendered.yaml',
    pattern: /ghcr\.io\/iuliandita\/digarr@(sha256:[a-f0-9]{64})/,
    label: 'rendered digest',
  },
  {
    path: 'deploy/unraid/digarr.xml',
    pattern: /Digest pin \(synced via scripts\/sync-deploy-digests\.ts\): (sha256:[a-f0-9]{64})/,
    label: 'unraid digest comment',
  },
]

const digests = new Map<string, string>()
for (const t of digestTargets) {
  const found = capture(t.path, read(t.path), t.pattern, t.label)
  if (found) digests.set(t.path, found)
}
if (new Set(digests.values()).size > 1) {
  const detail = [...digests.entries()].map(([k, v]) => `${k}=${v.slice(0, 19)}...`).join(', ')
  findings.push({
    file: 'deploy/*',
    message: `image digests disagree: ${detail} - run \`bun scripts/sync-deploy-digests.ts v<tag>\``,
  })
}

// -----------------------------------------------------------------------------

if (findings.length > 0) {
  console.error(`version drift detected (package.json v${pkgVersion}):`)
  for (const f of findings) {
    console.error(`  ${f.file}: ${f.message}`)
  }
  process.exit(1)
}

console.log(`version surfaces consistent: release v${pkgVersion}, image pins v${pinned ?? 'n/a'}`)
