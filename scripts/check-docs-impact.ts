#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  acceptReview,
  type CompanionReview,
  type ContractsLock,
  changedSources,
  checkContracts,
  createBaseline,
  createSnapshot,
  DOMAIN_NAMES,
  isDomain,
  LOCK_PATH,
  type Review,
  readBaseContext,
  validateLock,
} from './lib/docs-contracts'

const HELP = `Documentation contract guard
  bun scripts/check-docs-impact.ts [--base <commit-sha>]
  bun scripts/check-docs-impact.ts --explain [domain]
  bun scripts/check-docs-impact.ts --init --note "specific baseline explanation" --companion 'repo|status|url|specific explanation' (one per companion)
  bun scripts/check-docs-impact.ts --accept <domain> --docs <comma-separated-paths> --note "specific explanation" --breaking none [--migration "upgrade, rollback, backup consequences"]
  bun scripts/check-docs-impact.ts --accept <domain> --no-impact "specific explanation" --breaking none [--migration "upgrade, rollback, backup consequences"]
  Companion initialization and acceptance require two --companion 'repo|status|url|specific explanation' flags.
  status: updated, pending, or unaffected; unaffected may leave url empty.
  New sources must be Git-added before review. Snapshots hash working-tree contents of tracked/staged files.
  --base checks the merge-base to HEAD range plus local tracked/staged changes.
  Domain names: ${DOMAIN_NAMES.join(', ')}`

export function runCli(args: string[], root = process.cwd()): number {
  try {
    const options = new Map<string, string>()
    const companions: CompanionReview[] = []
    for (let index = 0; index < args.length; index++) {
      const flag = args[index]
      if (!flag) continue
      if (flag === '--help') {
        console.log(HELP)
        return 0
      }
      if (flag === '--init') {
        options.set(flag, 'true')
        continue
      }
      if (flag === '--explain' && (!args[index + 1] || args[index + 1]?.startsWith('--'))) {
        options.set(flag, '')
        continue
      }
      if (
        ![
          '--explain',
          '--accept',
          '--docs',
          '--note',
          '--breaking',
          '--migration',
          '--no-impact',
          '--base',
          '--companion',
        ].includes(flag)
      )
        throw new Error(`unknown option: ${flag}`)
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
      if (flag === '--companion') {
        const [repo, status, url, ...note] = value.split('|')
        if (!repo || !['updated', 'pending', 'unaffected'].includes(status ?? '') || !note.length)
          throw new Error('--companion requires repo|status|url|specific explanation')
        companions.push({
          repo,
          status: status as CompanionReview['status'],
          ...(url ? { url } : {}),
          note: note.join('|'),
        })
      } else {
        if (options.has(flag)) throw new Error(`duplicate option: ${flag}`)
        options.set(flag, value)
      }
    }
    const modes = ['--init', '--accept', '--explain'].filter((flag) => options.has(flag))
    if (modes.length > 1) throw new Error('choose one of --init, --accept, or --explain')
    if (
      !options.has('--accept') &&
      ['--docs', '--breaking', '--migration', '--no-impact'].some((flag) => options.has(flag))
    )
      throw new Error('review flags require --accept')
    if (!options.has('--accept') && !options.has('--init') && companions.length)
      throw new Error('--companion requires --init or --accept companions')
    const snapshots = createSnapshot(root)
    const path = join(root, LOCK_PATH)
    const base = options.has('--base')
      ? readBaseContext(root, options.get('--base') ?? '')
      : undefined
    const save = (lock: ContractsLock) => {
      mkdirSync(dirname(path), { recursive: true })
      const temporary = `${path}.${process.pid}.tmp`
      try {
        writeFileSync(temporary, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx' })
        renameSync(temporary, path)
      } finally {
        rmSync(temporary, { force: true })
      }
    }
    if (options.has('--init')) {
      if (existsSync(path))
        throw new Error('contract lock already exists; use --accept for a reviewed domain')
      save(createBaseline(root, snapshots, options.get('--note') ?? '', companions))
      console.log(
        `Initialized ${LOCK_PATH}; all ${DOMAIN_NAMES.length} domains have baseline receipts.`,
      )
      return 0
    }
    if (!existsSync(path))
      throw new Error(`missing ${LOCK_PATH}; initialize the first baseline with --init --note`)
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const invalid = validateLock(root, value, { historical: options.has('--accept') })
    if (invalid.length)
      throw new Error(
        invalid.map((finding) => `${finding.domain ?? 'lock'}: ${finding.message}`).join('\n'),
      )
    let lock = value as ContractsLock
    if (options.has('--accept')) {
      const domain = options.get('--accept') ?? ''
      if (!isDomain(domain)) throw new Error(`unknown domain: ${domain}`)
      const noImpact = options.get('--no-impact')
      if (noImpact && (options.has('--docs') || options.has('--note')))
        throw new Error('--no-impact cannot be combined with --docs or --note')
      if (!options.has('--breaking'))
        throw new Error('--accept requires --breaking none or a specific explanation')
      if (domain !== 'companions' && companions.length)
        throw new Error('--companion is only valid for the companions domain')
      const review: Omit<Review, 'digest'> = {
        outcome: noImpact ? 'no-impact' : 'docs-updated',
        docs: noImpact
          ? []
          : (options.get('--docs') ?? '')
              .split(',')
              .map((doc) => doc.trim())
              .filter(Boolean),
        note: noImpact ?? options.get('--note') ?? '',
        breaking: options.get('--breaking') ?? '',
        migration:
          options.get('--migration') ?? (domain === 'data-recovery' && noImpact ? noImpact : ''),
        ...(domain === 'companions' ? { companions } : {}),
      }
      lock = acceptReview(root, lock, snapshots, domain, review)
      if (base) {
        const findings = checkContracts(root, lock, snapshots, base).filter(
          (finding) => !finding.domain || finding.domain === domain,
        )
        if (findings.length)
          throw new Error(
            findings.map((finding) => `${finding.domain ?? 'lock'}: ${finding.message}`).join('\n'),
          )
      }
      save(lock)
      console.log(`Accepted ${domain}: ${review.outcome}.`)
      return 0
    }
    if (options.has('--explain')) {
      const domain = options.get('--explain') ?? ''
      if (domain && !isDomain(domain)) throw new Error(`unknown domain: ${domain}`)
      for (const name of DOMAIN_NAMES.filter((name) => !domain || name === domain)) {
        const changes = changedSources(lock.domains[name], snapshots[name])
        console.log(
          `${name}: ${changes.length ? `changed ${changes.join(', ')}` : 'current'}; reviewed docs: ${lock.domains[name].review.docs.join(', ') || '(no-impact)'}`,
        )
      }
    }
    const findings = checkContracts(root, lock, snapshots, base)
    if (findings.length) {
      for (const finding of findings)
        console.error(`${finding.domain ?? 'lock'}: ${finding.message}`)
      return 1
    }
    console.log(`Documentation contracts current (${DOMAIN_NAMES.length} domains).`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runCli(process.argv.slice(2))
