#!/usr/bin/env bun

import type { LegacyOidcBindingRecoveryParams } from '../src/db/queries/users'

const USAGE =
  'Usage: bun scripts/recover-oidc-binding.ts --user-id N --subject EXPECTED --issuer HISTORICAL [--apply]'

export function parseRecoveryArgs(args: string[]): LegacyOidcBindingRecoveryParams {
  const values = new Map<string, string>()
  let apply = false
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--apply') {
      if (apply) throw new Error(USAGE)
      apply = true
      continue
    }
    if (!flag || !['--user-id', '--subject', '--issuer'].includes(flag) || values.has(flag)) {
      throw new Error(USAGE)
    }
    const value = args[++index]
    if (!value) throw new Error(USAGE)
    values.set(flag, value)
  }
  const id = values.get('--user-id')
  const subject = values.get('--subject')
  const issuer = values.get('--issuer')
  if (
    !id ||
    !/^[1-9]\d*$/.test(id) ||
    !Number.isSafeInteger(Number(id)) ||
    !subject?.trim() ||
    !issuer?.trim()
  ) {
    throw new Error(USAGE)
  }
  return { userId: Number(id), subject, issuer, apply }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log(USAGE)
    console.log(
      'Dry run by default. Supply the verified historical issuer, not the current provider configuration.',
    )
    return
  }
  const params = parseRecoveryArgs(args)
  const { closeDb, db, dbBackend } = await import('../src/db')
  try {
    const { recoverLegacyOidcBinding } = await import('../src/db/queries/users')
    console.log(`using ${dbBackend} backend`)
    const result = await recoverLegacyOidcBinding(db, params)
    console.log(JSON.stringify(result))
  } finally {
    await closeDb()
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
