#!/usr/bin/env bun

import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { backupFileSchema } from '@/server/schemas/admin'

const USAGE = 'usage: bun scripts/prepare-rollback-backup.ts <input> <output>'

export function prepareRollbackBackup(inputPath: string, outputPath: string): void {
  const resolvedInput = resolve(inputPath)
  const resolvedOutput = resolve(outputPath)
  if (resolvedInput === resolvedOutput) {
    throw new Error('input and output paths must differ')
  }

  const source = readFileSync(resolvedInput, 'utf8')
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
  if (Object.hasOwn(parsed.data, 'oidcTokens')) {
    throw new Error('input backup must not contain oidcTokens')
  }

  const output = {
    ...parsed,
    data: { ...parsed.data, oidcTokens: [] },
  }
  try {
    writeFileSync(resolvedOutput, `${JSON.stringify(output, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('output path already exists')
    }
    throw error
  }
  chmodSync(resolvedOutput, 0o600)
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
