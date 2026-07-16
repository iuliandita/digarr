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
  it('requires every macOS compatibility assertion to complete', () => {
    const workflow = readFileSync('.github/workflows/compatibility.yml', 'utf8')
    const macJob = workflow.split('  docker-macos:')[1] ?? ''

    expect(macJob.match(/continue-on-error: true/g)).toHaveLength(1)
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
