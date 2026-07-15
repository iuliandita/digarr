// @vitest-environment node

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const checker = resolve('scripts/check-version-drift.ts')
const digest = `sha256:${'0'.repeat(64)}`

function writeFixture(root: string, path: string, content: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

describe('version drift checker', () => {
  it('rejects a stale Unraid tag description', () => {
    const root = mkdtempSync(join(tmpdir(), 'digarr-version-drift-'))
    const fixtures: Record<string, string> = {
      'package.json': '{"version":"1.13.0"}\n',
      'CHANGELOG.md': '## v1.13.0 - 2026-07-15\n',
      'README.md':
        '**v1.13.0 is out.** Use a minor tag like `:1.13` or a specific patch like `:1.13.0`.\n',
      'docs/ROADMAP.md': 'Current: v1.13.0\n',
      'deploy/helm/digarr/Chart.yaml': 'version: 1.13.0\nappVersion: "1.13.0"\n',
      'deploy/helm/digarr/values.yaml': `image:\n  tag: "1.13.0"\n  digest: "${digest}"\n`,
      'deploy/k8s/deployment.yaml': `image: ghcr.io/iuliandita/digarr@${digest}\n`,
      'deploy/k8s/rendered.yaml': `image: ghcr.io/iuliandita/digarr@${digest}\n`,
      'deploy/unraid/digarr.xml': [
        `<!-- Digest pin (synced via scripts/sync-deploy-digests.ts): ${digest} -->`,
        '<Repository>docker.io/iuliandita/digarr:1.13.0</Repository>',
        '<Tag>1.13.0</Tag>',
        '<TagDescription>v1.12.0 release</TagDescription>',
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

    try {
      for (const [path, content] of Object.entries(fixtures)) {
        writeFixture(root, path, `${content}\n`)
      }

      const result = spawnSync('bun', [checker], {
        cwd: root,
        encoding: 'utf8',
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('unraid TagDescription')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
