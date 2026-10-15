// @vitest-environment node

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const checker = resolve('scripts/check-version-drift.ts')
const digest = `sha256:${'0'.repeat(64)}`

type FixturePath =
  | 'package.json'
  | 'CHANGELOG.md'
  | 'README.md'
  | 'docs/ROADMAP.md'
  | 'docs/API.md'
  | 'deploy/helm/digarr/Chart.yaml'
  | 'deploy/helm/digarr/values.yaml'
  | 'deploy/k8s/deployment.yaml'
  | 'deploy/k8s/rendered.yaml'
  | 'deploy/unraid/digarr.xml'
  | 'deploy/docker/docker-compose.yml'
  | 'deploy/docker/docker-compose.pglite.yml'

type Fixtures = Record<FixturePath, string>

function writeFixture(root: string, path: string, content: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function runChecker(release = '1.13.0', update: (fixtures: Fixtures) => void = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'digarr-version-drift-'))
  const fixtures: Fixtures = {
    'package.json': '{"version":"1.13.0"}\n',
    'CHANGELOG.md': '## v1.13.0 - 2026-07-15\n',
    'README.md':
      '**v1.13.0 is out.** Use a minor tag like `:1.13` or a specific patch like `:1.13.0`.\n',
    'docs/ROADMAP.md': 'Current: v1.13.0\n',
    'docs/API.md': 'This reference covers v1.13.0.\n',
    'deploy/helm/digarr/Chart.yaml': 'version: 1.13.0\nappVersion: "1.13.0"\n',
    'deploy/helm/digarr/values.yaml': `image:\n  tag: "1.13.0"\n  digest: "${digest}"\n`,
    'deploy/k8s/deployment.yaml': `image: ghcr.io/iuliandita/digarr@${digest}\n`,
    'deploy/k8s/rendered.yaml': `image: ghcr.io/iuliandita/digarr@${digest}\n`,
    'deploy/unraid/digarr.xml': [
      `<!-- Digest pin (synced via scripts/sync-deploy-digests.ts): ${digest} -->`,
      '<Repository>docker.io/iuliandita/digarr:1.13.0</Repository>',
      '<Tag>1.13.0</Tag>',
      '<TagDescription>v1.13.0 release</TagDescription>',
    ].join('\n'),
    'deploy/docker/docker-compose.yml': [
      '#   :1.13 -> current minor release line, patch fixes only',
      '# image: docker.io/iuliandita/digarr:1.13.0',
      '# image: docker.io/iuliandita/digarr:1.13.0-debian',
    ].join('\n'),
    'deploy/docker/docker-compose.pglite.yml': [
      '# Track patch fixes only: docker.io/iuliandita/digarr:1.13',
      '# Pin for zero surprises: docker.io/iuliandita/digarr:1.13.0',
      '# Debian variant: docker.io/iuliandita/digarr:1.13.0-debian',
    ].join('\n'),
  }

  const releaseTargets: FixturePath[] = [
    'package.json',
    'CHANGELOG.md',
    'README.md',
    'docs/ROADMAP.md',
    'docs/API.md',
    'deploy/helm/digarr/Chart.yaml',
    'deploy/docker/docker-compose.yml',
    'deploy/docker/docker-compose.pglite.yml',
  ]
  for (const path of releaseTargets) {
    fixtures[path] = fixtures[path]
      .replaceAll('1.13.0', release)
      .replaceAll(':1.13', `:${release.split('.').slice(0, 2).join('.')}`)
  }
  update(fixtures)

  try {
    for (const [path, content] of Object.entries(fixtures)) {
      writeFixture(root, path, `${content}\n`)
    }

    return spawnSync('bun', [checker], {
      cwd: root,
      encoding: 'utf8',
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('version drift checker', () => {
  it('rejects a stale Unraid tag description', () => {
    const result = runChecker('1.13.0', (fixtures) => {
      fixtures['deploy/unraid/digarr.xml'] = fixtures['deploy/unraid/digarr.xml'].replace(
        'v1.13.0 release',
        'v1.12.0 release',
      )
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unraid TagDescription')
  })

  it.each(['1.13.1', '1.14.0', '2.0.0'])(
    'accepts release %s examples before published image pins advance',
    (release) => {
      const result = runChecker(release)
      expect(result.status, result.stderr).toBe(0)
    },
  )

  const surfaces: ReadonlyArray<readonly [path: FixturePath, example: string, label: string]> = [
    ['README.md', 'specific patch like `:2.0.0`', 'README patch pin example'],
    ['README.md', 'minor tag like `:2.0`', 'README minor pin example'],
    [
      'deploy/docker/docker-compose.yml',
      '# image: docker.io/iuliandita/digarr:2.0.0\n',
      'compose patch pin',
    ],
    ['deploy/docker/docker-compose.yml', ':2.0.0-debian', 'compose debian pin'],
    ['deploy/docker/docker-compose.yml', ':2.0 ->', 'compose minor channel comment'],
    [
      'deploy/docker/docker-compose.pglite.yml',
      'surprises: docker.io/iuliandita/digarr:2.0.0',
      'pglite compose patch pin',
    ],
    ['deploy/docker/docker-compose.pglite.yml', ':2.0.0-debian', 'pglite compose debian pin'],
    [
      'deploy/docker/docker-compose.pglite.yml',
      'fixes only: docker.io/iuliandita/digarr:2.0\n',
      'pglite compose minor pin',
    ],
    ['docs/API.md', 'This reference covers v2.0.0', 'API reference version'],
  ]

  it.each(
    surfaces.flatMap(([path, example, label]) =>
      ['stale', 'missing'].map((state) => ({ path, example, label, state })),
    ),
  )('rejects $state $label while published pins agree', ({ path, example, label, state }) => {
    const result = runChecker('2.0.0', (fixtures) => {
      fixtures[path] = fixtures[path].replace(
        example,
        state === 'missing'
          ? ''
          : example.replaceAll('2.0.0', '1.13.0').replaceAll(':2.0', ':1.13'),
      )
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(label)
    if (state === 'missing') expect(result.stderr).toContain(`could not locate ${label}`)
  })
})
