import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main, validateReleaseTag } from '../../scripts/check-release-identity'

const directories: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('release identity', () => {
  it('accepts a tag matching the packaged stable version', () => {
    expect(() => validateReleaseTag('v1.19.0', '1.19.0')).not.toThrow()
  })
  it.each(['v1.20.0', 'v1.19.1', 'v2.0.0'])('rejects mismatched tag %s', (tag) => {
    expect(() => validateReleaseTag(tag, '1.19.0')).toThrow('does not match')
  })
  it.each(['1.19.0', 'v1.19.0-rc.1', 'v01.19.0', 'v1.019.0', 'v1.19.00', 'v1.19.0\nsha=forged'])(
    'rejects unsupported tag %s',
    (tag) => {
      expect(() => validateReleaseTag(tag, '1.19.0')).toThrow('plain vX.Y.Z')
    },
  )
  it('emits the checked-out commit and validated tag for downstream jobs', () => {
    const root = mkdtempSync(join(tmpdir(), 'digarr-release-identity-'))
    directories.push(root)
    writeFileSync(join(root, 'package.json'), '{"version":"1.19.0"}')
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    execFileSync('git', ['add', 'package.json'], { cwd: root })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: root },
    )
    const expected = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    const output = join(root, 'outputs')
    vi.stubEnv('GITHUB_OUTPUT', output)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(main(['v1.20.0'], root)).toBe(1)
    expect(main(['v1.19.0'], root)).toBe(0)
    expect(readFileSync(output, 'utf8')).toBe(`sha=${expected}\ntag=v1.19.0\n`)
  })
})
