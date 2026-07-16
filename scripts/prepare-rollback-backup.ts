#!/usr/bin/env bun

import { closeSync, fchmodSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { backupFileSchema } from '@/server/schemas/admin'

const USAGE = 'usage: prepare-rollback-backup <input> <output>'

export function prepareRollbackBackup(inputPath: string, outputPath: string): void {
  const resolvedInput = resolve(inputPath)
  const resolvedOutput = resolve(outputPath)
  if (resolvedInput === resolvedOutput) {
    throw new Error('input and output paths must differ')
  }

  let source: string
  try {
    source = readFileSync(resolvedInput, 'utf8')
  } catch {
    throw new Error('could not read input backup')
  }
  let untrusted: unknown
  try {
    untrusted = JSON.parse(source)
  } catch {
    throw new Error('input is not valid JSON')
  }

  const result = backupFileSchema.safeParse(untrusted)
  if (!result.success) {
    throw new Error('input backup does not match the supported schema')
  }
  const parsed = result.data
  if (parsed.version !== 1) {
    throw new Error('input backup version must be 1')
  }
  if (Object.hasOwn(parsed.data, 'oidcTokens')) {
    throw new Error('input backup must not contain oidcTokens')
  }

  const output = {
    ...parsed,
    data: { ...parsed.data, oidcTokens: [] },
  }
  const serialized = `${JSON.stringify(output, null, 2)}\n`

  let fd: number
  try {
    fd = openSync(resolvedOutput, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('output path already exists')
    }
    throw new Error('could not create output backup')
  }

  let closeAttempted = false
  try {
    fchmodSync(fd, 0o600)
    writeFileSync(fd, serialized)
    fsyncSync(fd)
    closeAttempted = true
    closeSync(fd)
  } catch {
    if (!closeAttempted) {
      closeAttempted = true
      try {
        closeSync(fd)
      } catch {
        // The created object stays no broader than 0600 and must remain for manual removal.
      }
    }
    throw new Error('output may be incomplete and must be removed before retrying')
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length !== 2) {
    console.error(USAGE)
    process.exit(1)
  }

  try {
    const [inputPath, outputPath] = args as [string, string]
    prepareRollbackBackup(inputPath, outputPath)
    console.log(resolve(outputPath))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'rollback backup preparation failed')
    process.exit(1)
  }
}
