# Keeping documentation current

Documentation is part of a change. A feature needs usable instructions, a breaking change needs an upgrade path, and a migration needs backup and rollback instructions. Passing a static check does not establish that the instructions are true. Review the affected behavior and record what you checked.

## Run the checks

```sh
bun run check:docs
bun scripts/check-docs-impact.ts --explain
```

`check:docs` runs the existing version and API inventory checks, local Markdown link and anchor checks, literal environment-name coverage, and source-impact checks. It runs in the required CI job, the release quality gate, and the optional local pre-push hook. Activate the hook with `git config --local core.hooksPath .githooks`. Bun and Node.js 22.18 or newer are required. The environment check uses the installed TypeScript compiler through Node.js because its native parser transport requires Node APIs. The hook fails if a required runtime is missing.

The PR check also compares against the PR base. Locally, use a fetched base commit:

```sh
bun scripts/check-docs-impact.ts --base "$(git rev-parse github/develop)"
```

This checks the merge-base-to-HEAD range and local changes. It prevents a stale receipt from being reused and requires claimed documentation updates to appear in the change. It needs Git history; CI fetches the full history. The plain check works without a PR base and verifies that the committed receipts match current source.

## Review the affected domains

`docs/contracts.lock.json` records source fingerprints and review receipts for ten domains: companions, data recovery, configuration, authentication, API, interface, features, deployment, release, and maintenance. The rules live in `scripts/lib/docs-contracts.ts`; inspect them with `--explain` when the guard reports a change. New `src/` runtime files are included through the fallback feature domain. Runtime CSS, HTML entry points, the Vite build configuration, and deployment settings also have coverage; use `--explain` to inspect the exact file membership. Package dependency versions, Digarr release pins, and action revisions have narrower existing checks or exclusions. Runtime and base-image changes still require a review receipt; record a specific no-impact decision when appropriate. New source files must be staged before the guard can include them; ignored and untracked scratch files are excluded.

Read the affected implementation and its guides. Update the relevant docs, then accept that domain:

```sh
bun scripts/check-docs-impact.ts --accept configuration \
  --docs .env.example,docs/OPERATIONS.md \
  --note "Document the new environment setting and its restart requirement." \
  --breaking none
```

Use paths the domain permits. A receipt covers the exact source fingerprint, so accepting it before the last source edit leaves it stale. Commit the lock with the source and docs. If two branches change the same domain, resolve the source first, review the combined behavior, and create a new receipt. Do not choose one branch's hash to clear a conflict.

A refactor may need no documentation change. Record a specific reason:

```sh
bun scripts/check-docs-impact.ts --accept features \
  --no-impact "Move the scorer helper without changing inputs, outputs, or ranking behavior." \
  --breaking none
```

A sentence-length check cannot prove this explanation. Reviewers must challenge it against the diff. Do not use a generic "docs reviewed" receipt or edit the hashes by hand.

## Breaking changes and migrations

For a breaking change, replace `--breaking none` with its concrete compatibility consequence. Update the changelog and an allowed domain guide. Explain who is affected, what they must change, how to back up, how to upgrade, and what rollback can restore. A declared breaking change cannot use the no-impact path.

Database migration changes require `CHANGELOG.md`, `docs/OPERATIONS.md`, and `docs/guides/switching-backends.md`, plus a migration receipt:

```sh
bun scripts/check-docs-impact.ts --accept data-recovery \
  --docs CHANGELOG.md,docs/OPERATIONS.md,docs/guides/switching-backends.md \
  --note "Describe the schema change and the supported recovery procedure." \
  --breaking "Older application versions cannot read the migrated schema." \
  --migration "Take a complete database backup before upgrading; rollback restores that backup with the previous image."
```

These are illustrative instructions for the guard, not a description of an existing migration. Use the actual compatibility behavior. Record the validation performed in the PR: for example, an isolated upgrade and restore using synthetic data. Say plainly when live recovery or a provider integration was not tested. SQL migration and migration-journal changes cannot be cleared as no-impact. Other operations, schema, key-rotation, and rollback-tool changes still need a specific upgrade, rollback, and backup assessment. Query-only refactors may use a specific no-impact receipt without that extra note.

When promoting several PRs from develop to main, review the combined range. The lock stores the latest receipt for each domain, so a later query-only receipt can supersede an earlier migration receipt. Reaccept the data-recovery domain for the release range with all three required guides and the combined upgrade, backup, and rollback assessment. The range check deliberately fails until that combined review is recorded. Reassess breaking-change consequences across the entire release as well; individual no-impact receipts do not establish release compatibility.

## Unraid companion repositories

Changes to the bundled template, container defaults, ports, persistent paths, database settings, permissions, authentication, or upgrade instructions can affect both [the personal template repository](https://github.com/iuliandita/unraid-templates) and [the Community Applications repository](https://github.com/selfhosters/unRAID-CA-templates). Check both before shipping. A local template change also requires companion records in the lock:

```sh
bun scripts/check-docs-impact.ts --accept companions \
  --docs docs/guides/unraid.md \
  --note "Explain the changed container setting and the store-template workaround." \
  --breaking none \
  --companion 'iuliandita/unraid-templates|pending|https://github.com/iuliandita/unraid-templates/pull/4|The proposed template correction is awaiting merge.' \
  --companion 'selfhosters/unRAID-CA-templates|pending|https://github.com/selfhosters/unRAID-CA-templates/pull/697|The proposed store correction is awaiting merge.'
```

Those PRs illustrate the record format; verify their current state and use the PR for your change. Status is `pending`, `updated`, or `unaffected`. Pending and updated records require a PR URL for the corresponding repository. An unaffected record needs a specific explanation and may omit the URL. A pending PR does not mean the published template is fixed; document a workaround when users need one.

```sh
bun run check:companions
```

This fetches both published templates and compares configuration fields and operator help with the bundled template. Image repository identity is compared, allowing the Digarr Docker Hub and GHCR aliases. Moving `latest` tags, release pins, and digest comments are intentionally excluded. Templates must use UTF-8 XML without DTD or entity declarations. Exit 0 means aligned, 1 means differences, and 2 means the comparison was unavailable or invalid. Python 3 and network access are required. The weekly and manually triggered Companion templates workflow produces an advisory report; network outages and pending external PRs do not block normal CI. Check existing PRs before opening duplicate work.

## Limits and release checks

The Markdown parser covers common local links and anchors; it is not a complete CommonMark renderer and does not check remote links. Environment coverage scans tracked `src/**/*.ts` and `src/**/*.tsx` for literal names and known access patterns, including file variants; it cannot infer dynamically constructed names. Source hashes detect a review obligation, not semantic correctness, valid translations, current screenshots, or working examples. Keep the existing tests, i18n check, Helm rendering, and release version checks.

The release workflow rejects a tag that differs from package.json and passes one resolved commit from the quality gate to both image builds. Manual runs check out an explicit tag; tag pushes use the triggering commit. Run the full documented release checks and review the changelog, upgrade notes, API compatibility, deployment instructions, and companion status. A green guard alone is not a release qualification.

The initial lock is an explicit baseline, not evidence that every line of documentation was verified. `--init --note` only creates a missing lock and requires explicit records for both companions; routine changes use `--accept`. Review changes to the guard, its exclusions, and the lock itself as code. Never regenerate the baseline to bypass an unresolved finding.

Changing the domain set or lock schema requires an explicit migration of the lock reader and existing receipts, with tests against the previous format. The current guard supports source-mapping changes within its ten domains; it does not automatically migrate added or removed domains.
