#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function validateReleaseTag(tag: string, version: string): void {
  if (!/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(tag))
    throw new Error('Release tag must be a plain vX.Y.Z version without leading zeros.')
  if (tag !== `v${version}`)
    throw new Error(`Release tag ${tag} does not match package.json version ${version}.`)
}

export function main(args: string[], root = process.cwd()): number {
  try {
    if (args.length !== 1 || !args[0]) throw new Error('Usage: check-release-identity.ts vX.Y.Z')
    const pkg: unknown = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    if (
      typeof pkg !== 'object' ||
      pkg === null ||
      !('version' in pkg) ||
      typeof pkg.version !== 'string'
    )
      throw new Error('package.json must contain a string version.')
    const tag = args[0]
    validateReleaseTag(tag, pkg.version)
    const sha = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Cannot resolve the release commit.')
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\ntag=${tag}\n`)
    console.log(`Release identity verified: ${tag} at ${sha}.`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2))
