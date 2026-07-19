// @vitest-environment node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTargetUpdates,
  parseReleaseTag,
  type SyncTarget,
  syncDeployDigests,
} from '../../scripts/sync-deploy-digests'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sync-deploy-digests CLI', () => {
  it('rejects a malformed tag', () => {
    const result = spawnSync('bun', ['scripts/sync-deploy-digests.ts', 'not-a-version'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5_000,
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('invalid tag "not-a-version"')
  })
})

describe('stable release tags', () => {
  it.each([
    ['v1.2.3', '1.2.3'],
    ['1.2.3', '1.2.3'],
  ])('normalizes %s', (input, expected) => {
    expect(parseReleaseTag(input)).toBe(expected)
  })

  it.each(['v1.2.3-rc.1', '1.2.3+build.4'])('rejects non-release tag %s', (input) => {
    expect(() => parseReleaseTag(input)).toThrow('expected vX.Y.Z or X.Y.Z')
  })

  it('rejects a prerelease before registry access', async () => {
    const fetchMock = vi.fn<typeof fetch>()

    await expect(
      syncDeployDigests({
        tagArg: 'v1.2.3-rc.1',
        fetch: fetchMock,
        readFile: vi.fn(),
        writeFile: vi.fn(),
        log: vi.fn(),
      }),
    ).rejects.toThrow('expected vX.Y.Z or X.Y.Z')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('release workflow policy', () => {
  it('contains no prerelease release path', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')

    expect(workflow).toMatch(/\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/)
    expect(workflow).not.toMatch(
      /prerelease=true|prerelease=false|--prerelease|channel=rc|steps\.tag\.outputs\.prerelease/,
    )
  })
})

describe('CI workflow reliability policy', () => {
  it('pins a viable macOS Docker runner and requires every assertion to complete', () => {
    const workflow = readFileSync('.github/workflows/compatibility.yml', 'utf8')
    const macJob = workflow.split('  docker-macos:')[1] ?? ''

    expect(macJob).toContain('runs-on: macos-15-intel')
    expect(macJob.match(/continue-on-error: true/g)).toHaveLength(1)
    expect(macJob).toContain('--accept-license')
    expect(macJob).toContain('--user="$USER"')
    expect(macJob).toContain('docker desktop start --timeout 300')
    expect(macJob).toContain('name: Diagnose Docker Desktop startup')
    expect(macJob).toContain('docker desktop status')
    expect(macJob).toContain('docker desktop logs --priority 2')
    expect(macJob).toContain('Data/log/vm/init.log')
    expect(macJob).toContain('id: docker')
    expect(macJob).toContain('id: postgres_assert')
    expect(macJob).toContain('id: pglite_assert')
    expect(macJob).toContain('if: always()')
    expect(macJob).toContain('POSTGRES_ASSERTED')
    expect(macJob).toContain('PGLITE_ASSERTED')
  })

  it('bounds Forgejo package and Helm downloads without suppressing drift', () => {
    const workflow = readFileSync('.forgejo/workflows/ci.yml', 'utf8')
    const helmJob = workflow.split('  helm-drift:')[1]?.split('\n  browser-test:')[0] ?? ''

    expect(helmJob).toContain('Acquire::Retries=3')
    expect(helmJob).toContain('--connect-timeout 15')
    expect(helmJob).toContain('--max-time 120')
    expect(helmJob).toContain('sha256sum -c -')
    expect(helmJob).toContain('helm lint deploy/helm/digarr')
    expect(helmJob).toContain('git diff --exit-code -- deploy/k8s/rendered.yaml')
  })

  it('runs PostgreSQL session races after migrations in both CI mirrors', () => {
    for (const path of ['.github/workflows/ci.yml', '.forgejo/workflows/ci.yml']) {
      const workflow = readFileSync(path, 'utf8')
      const apiJob = workflow.split('  api-route-test:')[1]?.split('\n  helm-drift:')[0] ?? ''
      const migrationIndex = apiJob.indexOf('run: bun run db:migrate')
      const sessionTestIndex = apiJob.indexOf(
        'run: bunx vitest run tests/db/session-queries.test.ts',
      )
      const routeTestIndex = apiJob.indexOf('run: bun run test:api-routes')

      expect(migrationIndex).toBeGreaterThan(-1)
      expect(sessionTestIndex).toBeGreaterThan(migrationIndex)
      expect(routeTestIndex).toBeGreaterThan(sessionTestIndex)
      expect(apiJob.match(/Run PostgreSQL session concurrency tests/g)).toHaveLength(1)
    }
  })

  it('runs cookie-auth browser coverage consistently in both CI mirrors', () => {
    const githubWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const githubBrowser = githubWorkflow.split('  browser-test:')[1]?.split('\n  a11y:')[0] ?? ''
    const forgejoWorkflow = readFileSync('.forgejo/workflows/ci.yml', 'utf8')
    const forgejoBrowser = forgejoWorkflow.split('  browser-test:')[1]?.split('\n  a11y:')[0] ?? ''
    const playwrightConfig = readFileSync('playwright.config.ts', 'utf8')

    expect(githubBrowser).toContain('playwright install --with-deps chromium firefox')
    expect(forgejoBrowser).toContain('playwright install --with-deps chromium firefox')
    expect(playwrightConfig).toContain("PROXY_AUTH_ENABLED: 'true'")
    expect(playwrightConfig).toContain("ALLOWED_ORIGIN: 'http://localhost:5173'")
    expect(playwrightConfig).toContain("PROXY_AUTH_TRUSTED_PROXIES: '127.0.0.0/8,::1/128'")
    expect(playwrightConfig).toContain("DIGARR_DISABLE_REGISTRATION: 'false'")
    expect(playwrightConfig).toContain('tests/e2e/browser/start-oidc-mock.ts')
    expect(playwrightConfig).toContain("ALLOWED_ORIGIN: 'http://127.0.0.1:3011'")
    expect(forgejoBrowser).toContain('PROXY_AUTH_ENABLED=true')
    expect(forgejoBrowser).toContain('ALLOWED_ORIGIN=http://localhost:5173')
    expect(forgejoBrowser).toContain('PROXY_AUTH_TRUSTED_PROXIES=127.0.0.0/8,::1/128')
    expect(forgejoBrowser).toContain('DIGARR_DISABLE_REGISTRATION=false')
    expect(forgejoBrowser).toContain('tests/e2e/browser/start-oidc-mock.ts')
    expect(forgejoBrowser).toContain('ALLOWED_ORIGIN=http://127.0.0.1:3011')

    const githubA11y = readFileSync('.github/workflows/ci.yml', 'utf8').split('  a11y:')[1] ?? ''
    expect(githubA11y).toContain('playwright install --with-deps chromium')
    expect(githubA11y).not.toContain('firefox')
  })
})

describe('preflighted target updates', () => {
  it('writes nothing when any target pattern is missing', () => {
    const targets: SyncTarget[] = [
      {
        path: 'first.txt',
        pattern: /old/,
        replacement: () => 'new',
      },
      {
        path: 'second.txt',
        pattern: /missing/,
        replacement: () => 'new',
      },
    ]
    const contents = new Map([
      ['first.txt', 'old'],
      ['second.txt', 'unchanged'],
    ])
    const writeFile = vi.fn()

    expect(() =>
      applyTargetUpdates(
        targets,
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        (path) => contents.get(path) ?? '',
        writeFile,
      ),
    ).toThrow('no match in second.txt')
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('stages repeated rules and writes each deploy file once', async () => {
    vi.stubEnv('GH_TOKEN', '')
    const digest = `sha256:${'a'.repeat(64)}`
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: 'anonymous-token' }))
      .mockResolvedValueOnce(new Response(null, { headers: { 'docker-content-digest': digest } }))
    const writeFile = vi.fn()

    await syncDeployDigests({
      tagArg: 'v9.8.7',
      fetch: fetchMock,
      readFile: (path) => readFileSync(path, 'utf8'),
      writeFile,
      log: vi.fn(),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenCalledTimes(7)
    expect(writeFile.mock.calls.map(([path]) => path)).toEqual([
      'deploy/k8s/deployment.yaml',
      'deploy/helm/digarr/values.yaml',
      'deploy/k8s/rendered.yaml',
      'deploy/unraid/digarr.xml',
      'deploy/docker/docker-compose.yml',
      'deploy/docker/docker-compose.pglite.yml',
      'README.md',
    ])

    const writes = new Map<string, string>()
    for (const [path, content] of writeFile.mock.calls) writes.set(path, content)

    expect(writes.get('deploy/k8s/deployment.yaml')).toContain(`@${digest}`)
    expect(writes.get('deploy/helm/digarr/values.yaml')).toContain('tag: "9.8.7"')
    expect(writes.get('deploy/helm/digarr/values.yaml')).toContain(`digest: "${digest}"`)
    expect(writes.get('deploy/k8s/rendered.yaml')).toContain(`@${digest}`)
    expect(writes.get('deploy/unraid/digarr.xml')).toContain(
      `<Repository>docker.io/iuliandita/digarr:9.8.7</Repository>`,
    )
    expect(writes.get('deploy/unraid/digarr.xml')).toContain('<Tag>9.8.7</Tag>')
    expect(writes.get('deploy/unraid/digarr.xml')).toContain(
      '<TagDescription>v9.8.7 release</TagDescription>',
    )
    expect(writes.get('deploy/docker/docker-compose.yml')).toContain(
      ':9.8 -> current minor release line',
    )
    expect(writes.get('deploy/docker/docker-compose.yml')).toContain(
      'docker.io/iuliandita/digarr:9.8.7-debian',
    )
    expect(writes.get('deploy/docker/docker-compose.pglite.yml')).toContain(
      'docker.io/iuliandita/digarr:9.8',
    )
    expect(writes.get('deploy/docker/docker-compose.pglite.yml')).toContain(
      'docker.io/iuliandita/digarr:9.8.7-debian',
    )
    expect(writes.get('README.md')).toContain('minor tag like `:9.8`')
    expect(writes.get('README.md')).toContain('specific patch like `:9.8.7`')
  })
})
