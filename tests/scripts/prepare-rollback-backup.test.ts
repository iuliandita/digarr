// @vitest-environment node

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import { prepareRollbackBackup } from '../../scripts/prepare-rollback-backup'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    chmodSync: vi.fn(actual.chmodSync),
    closeSync: vi.fn(actual.closeSync),
    fchmodSync: vi.fn(actual.fchmodSync),
    fsyncSync: vi.fn(actual.fsyncSync),
    openSync: vi.fn(actual.openSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  }
})

const rollbackCompatibilitySchema = z.object({
  version: z.literal(1),
  data: z.object({ oidcTokens: z.array(z.never()).length(0) }),
})

function completeV1Backup() {
  return {
    version: 1,
    appVersion: '1.13.0',
    createdAt: '2026-07-16T10:00:00.000Z',
    encryptionKeyHash: 'test-fingerprint',
    includesCaches: true,
    data: {
      settings: [{ id: 1, preferences: { theme: 'digarr' } }],
      users: [{ id: 1, username: 'rollback-user' }],
      oauthTokens: [{ id: 1, provider: 'spotify', accessToken: 'oauth-test-value' }],
      targets: [{ id: 1, name: 'rollback-target' }],
      subscriptions: [{ id: 1, name: 'rollback-subscription' }],
      jobRuns: [{ id: 1, type: 'pipeline' }],
      recommendationBatches: [{ id: 1, source: 'manual' }],
      recommendations: [{ id: 1, name: 'Rollback Artist' }],
      playlists: [{ id: 1, name: 'Rollback Playlist' }],
      playlistTracks: [{ id: 1, title: 'Rollback Track' }],
      artists: [{ id: 1, name: 'Rollback Artist' }],
      artistGenreAliases: [{ id: 1, alias: 'alt rock' }],
      genres: [{ id: 1, name: 'Rock' }],
      artistMetadata: [{ id: 1, popularity: 42 }],
      artistBlocks: [{ id: 1, artistId: 1 }],
      albumBlocks: [{ id: 1, releaseGroupMbid: 'release-group' }],
      libraryArtists: [{ id: 1, sourceArtistId: 'artist-source' }],
      libraryAlbums: [{ id: 1, sourceAlbumId: 'album-source' }],
      librarySyncState: [{ id: 1, source: 'lidarr' }],
      libraryMatchOverrides: [{ id: 1, sourceArtistId: 'artist-source' }],
      libraryAlbumMatchOverrides: [{ id: 1, sourceAlbumId: 'album-source' }],
      libraryHealthState: [{ id: 1, checks: [] }],
      recordingArtistCache: [{ id: 1, artistName: 'Rollback Artist' }],
      slskdJobs: [{ id: 1, workKey: 'rollback-work' }],
      subscriptionRuns: [{ id: 1, type: 'subscription' }],
    },
  }
}

function writeBackup(path: string, backup: unknown): string {
  const content = `${JSON.stringify(backup, null, 2)}\n`
  writeFileSync(path, content)
  return content
}

function runCli(args: string[]) {
  return spawnSync('bun', ['scripts/prepare-rollback-backup.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5_000,
  })
}

describe('rollback backup preparation', () => {
  let testDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    testDir = mkdtempSync(join(tmpdir(), 'digarr-rollback-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('adds only an empty oidcTokens table to a complete v1 backup', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const backup = completeV1Backup()
    writeBackup(inputPath, backup)

    prepareRollbackBackup(inputPath, outputPath)

    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual({
      ...backup,
      data: { ...backup.data, oidcTokens: [] },
    })
    expect(readFileSync(outputPath, 'utf8').endsWith('\n')).toBe(true)
  })

  it('produces the strict version-1 rollback compatibility shape', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeBackup(inputPath, completeV1Backup())

    prepareRollbackBackup(inputPath, outputPath)

    const output = JSON.parse(readFileSync(outputPath, 'utf8'))
    expect(rollbackCompatibilitySchema.safeParse(output).success).toBe(true)
    expect(Object.hasOwn(output.data, 'oidcTokens')).toBe(true)
  })

  it('rejects a version-2 backup without leaking its contents', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const sentinel = 'version-two-provider-token-sentinel'
    const backup = completeV1Backup()
    writeBackup(inputPath, {
      ...backup,
      version: 2,
      data: { ...backup.data, oauthTokens: [{ id: 1, accessToken: sentinel }] },
    })
    let thrown: unknown

    try {
      prepareRollbackBackup(inputPath, outputPath)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('input backup version must be 1')
    expect((thrown as Error).message).not.toContain(sentinel)
    expect(existsSync(outputPath)).toBe(false)
  })

  it('creates the compatibility copy with mode 0600', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeBackup(inputPath, completeV1Backup())

    prepareRollbackBackup(inputPath, outputPath)

    expect(statSync(outputPath).mode & 0o777).toBe(0o600)
  })

  it('secures and persists the output through one exclusive descriptor', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeBackup(inputPath, completeV1Backup())

    prepareRollbackBackup(inputPath, outputPath)

    expect(openSync).toHaveBeenCalledWith(resolve(outputPath), 'wx', 0o600)
    const fd = vi.mocked(openSync).mock.results[0]?.value
    expect(fd).toEqual(expect.any(Number))
    expect(fchmodSync).toHaveBeenCalledWith(fd, 0o600)
    expect(writeFileSync).toHaveBeenCalledWith(fd, expect.any(String))
    expect(fsyncSync).toHaveBeenCalledWith(fd)
    expect(closeSync).toHaveBeenCalledWith(fd)
    expect(chmodSync).not.toHaveBeenCalled()
  })

  it('leaves a restrictive non-retryable output when descriptor setup fails', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const sentinel = 'descriptor-failure-provider-token-sentinel'
    writeBackup(inputPath, completeV1Backup())
    vi.mocked(fchmodSync).mockImplementationOnce(() => {
      throw new Error(sentinel)
    })
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
    let thrown: unknown

    try {
      prepareRollbackBackup(inputPath, outputPath)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(
      'output may be incomplete and must be removed before retrying',
    )
    expect((thrown as Error).message).not.toContain(sentinel)
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
    expect(existsSync(outputPath)).toBe(true)
    expect(statSync(outputPath).mode & 0o077).toBe(0)
    expect(closeSync).toHaveBeenCalled()
    expect(() => prepareRollbackBackup(inputPath, outputPath)).toThrow('output path already exists')
  })

  it('leaves the source file byte-for-byte unchanged', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const source = writeBackup(inputPath, completeV1Backup())

    prepareRollbackBackup(inputPath, outputPath)

    expect(readFileSync(inputPath, 'utf8')).toBe(source)
  })

  it('refuses an existing output without changing it', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeBackup(inputPath, completeV1Backup())
    prepareRollbackBackup(inputPath, outputPath)
    const firstOutput = readFileSync(outputPath)

    expect(() => prepareRollbackBackup(inputPath, outputPath)).toThrow('output path already exists')
    expect(readFileSync(outputPath)).toEqual(firstOutput)
  })

  it('refuses a preexisting symlink without changing its target', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const targetPath = join(testDir, 'unrelated.json')
    const targetContent = 'unrelated-content\n'
    writeBackup(inputPath, completeV1Backup())
    writeFileSync(targetPath, targetContent, { mode: 0o640 })
    chmodSync(targetPath, 0o640)
    symlinkSync(targetPath, outputPath)

    expect(() => prepareRollbackBackup(inputPath, outputPath)).toThrow('output path already exists')
    expect(readFileSync(targetPath, 'utf8')).toBe(targetContent)
    expect(statSync(targetPath).mode & 0o777).toBe(0o640)
  })

  it('refuses a preexisting hardlink without changing its target', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const targetPath = join(testDir, 'unrelated.json')
    const targetContent = 'unrelated-content\n'
    writeBackup(inputPath, completeV1Backup())
    writeFileSync(targetPath, targetContent, { mode: 0o640 })
    chmodSync(targetPath, 0o640)
    linkSync(targetPath, outputPath)

    expect(() => prepareRollbackBackup(inputPath, outputPath)).toThrow('output path already exists')
    expect(readFileSync(targetPath, 'utf8')).toBe(targetContent)
    expect(statSync(targetPath).mode & 0o777).toBe(0o640)
  })

  it('rejects the same resolved input and output path before reading', () => {
    const path = join(testDir, 'missing.json')

    expect(() => prepareRollbackBackup(path, path)).toThrow('must differ')
    expect(existsSync(path)).toBe(false)
  })

  it('rejects malformed JSON without creating output', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeFileSync(inputPath, '{"providerToken":"malformed-sentinel"')

    expect(() => prepareRollbackBackup(inputPath, outputPath)).toThrow('not valid JSON')
    expect(existsSync(outputPath)).toBe(false)
  })

  it('rejects a schema-invalid backup without creating output', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeBackup(inputPath, { version: 1, data: {} })

    expect(() => prepareRollbackBackup(inputPath, outputPath)).toThrow(
      'does not match the supported schema',
    )
    expect(existsSync(outputPath)).toBe(false)
  })

  it('rejects an input with an empty oidcTokens table', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const backup = completeV1Backup()
    writeBackup(inputPath, { ...backup, data: { ...backup.data, oidcTokens: [] } })

    expect(() => prepareRollbackBackup(inputPath, outputPath)).toThrow(
      'must not contain oidcTokens',
    )
    expect(existsSync(outputPath)).toBe(false)
  })

  it('rejects provider-token rows without leaking their contents', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const sentinel = 'provider-token-sentinel-387-do-not-emit'
    const backup = completeV1Backup()
    writeBackup(inputPath, {
      ...backup,
      data: { ...backup.data, oidcTokens: [{ id: 1, accessToken: sentinel }] },
    })
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
    let thrown: unknown

    try {
      prepareRollbackBackup(inputPath, outputPath)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('must not contain oidcTokens')
    expect((thrown as Error).message).not.toContain(sentinel)
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
    expect(existsSync(outputPath)).toBe(false)
  })

  it.each([
    { args: [] },
    { args: ['one.json'] },
    { args: ['one.json', 'two.json', 'three.json'] },
  ])('requires exactly input and output CLI arguments: $args', ({ args }) => {
    const result = runCli(args)

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe(
      'usage: bun scripts/prepare-rollback-backup.ts <input> <output>',
    )
  })

  it('prints only the resolved output path after CLI success', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeBackup(inputPath, completeV1Backup())

    const result = runCli([inputPath, outputPath])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${resolve(outputPath)}\n`)
    expect(result.stderr).toBe('')
  })

  it('keeps provider-token contents out of CLI failure output', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const sentinel = 'provider-token-sentinel-387-cli'
    const backup = completeV1Backup()
    writeBackup(inputPath, {
      ...backup,
      data: { ...backup.data, oidcTokens: [{ id: 1, refreshToken: sentinel }] },
    })

    const result = runCli([inputPath, outputPath])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('must not contain oidcTokens')
    expect(result.stderr).not.toContain(sentinel)
    expect(existsSync(outputPath)).toBe(false)
  })

  it('rejects a version-2 backup safely through the CLI', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const sentinel = 'version-two-provider-token-sentinel-cli'
    const backup = completeV1Backup()
    writeBackup(inputPath, {
      ...backup,
      version: 2,
      data: { ...backup.data, oauthTokens: [{ id: 1, refreshToken: sentinel }] },
    })

    const result = runCli([inputPath, outputPath])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe('input backup version must be 1')
    expect(result.stderr).not.toContain(sentinel)
    expect(existsSync(outputPath)).toBe(false)
  })

  it('does not expose a missing input path through the CLI', () => {
    const inputPath = join(testDir, 'missing-provider-token-sentinel.json')
    const outputPath = join(testDir, 'output.json')

    const result = runCli([inputPath, outputPath])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe('could not read input backup')
    expect(result.stderr).not.toContain('missing-provider-token-sentinel')
    expect(existsSync(outputPath)).toBe(false)
  })

  it('does not expose an output path when creation fails through the CLI', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'missing-provider-token-sentinel', 'output.json')
    writeBackup(inputPath, completeV1Backup())

    const result = runCli([inputPath, outputPath])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe('could not create output backup')
    expect(result.stderr).not.toContain('missing-provider-token-sentinel')
    expect(existsSync(outputPath)).toBe(false)
  })
})
