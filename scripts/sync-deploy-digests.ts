#!/usr/bin/env bun
/**
 * Sync image digest across deploy artefacts (k8s, Helm, Unraid).
 *
 * Usage: bun scripts/sync-deploy-digests.ts <tag>
 *   <tag> may be "v0.32.3" or "0.32.3" (leading "v" stripped).
 *
 * Fetches the multi-arch manifest digest from ghcr.io and rewrites both the
 * digest pins AND the human-readable version tags, so they cannot drift apart:
 *   - deploy/k8s/deployment.yaml      (image ref with @sha256:...)
 *   - deploy/helm/digarr/values.yaml  (digest: "sha256:..." + tag: "<ver>")
 *   - deploy/k8s/rendered.yaml        (image ref with @sha256:...)
 *   - deploy/unraid/digarr.xml        (digest comment + <Repository> :tag,
 *                                      <Tag>, <TagDescription>)
 *   - deploy/docker/docker-compose.yml        (example pin comments)
 *   - deploy/docker/docker-compose.pglite.yml (example pin comments)
 *   - README.md                               (example tag pins)
 *
 * rendered.yaml is a `helm template` snapshot, but at the digest-sync step the
 * only line that changes is the image digest, so a targeted string replace is
 * byte-identical to a full regen -- and needs no helm, avoiding the
 * local-helm-version-vs-CI drift that the helm-drift job would otherwise flag.
 * (Chart-version changes still require regenerating via scripts/k8s-sync.sh in
 * the release commit, where the chart version actually changes.)
 *
 * Auth: tries GH_TOKEN env first; falls back to anonymous token (public images).
 */

import { readFileSync, writeFileSync } from 'node:fs'

const REPO = 'iuliandita/digarr'

type Fetch = typeof fetch

export type SyncTarget = {
  path: string
  pattern: RegExp
  replacement: (digest: string, match: string, ...groups: string[]) => string
}

type SyncDeps = {
  tagArg?: string
  fetch: Fetch
  readFile: (path: string) => string
  writeFile: (path: string, content: string) => void
  log: (message: string) => void
}

export function parseReleaseTag(tagArg: string | undefined): string {
  if (!tagArg) throw new Error('usage: bun scripts/sync-deploy-digests.ts <tag>')

  const tag = tagArg.replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`invalid tag "${tagArg}" - expected vX.Y.Z or X.Y.Z`)
  }
  return tag
}

async function bearerToken(request: Fetch): Promise<string> {
  if (process.env.GH_TOKEN) {
    return Buffer.from(`v1:${process.env.GH_TOKEN}`).toString('base64')
  }
  const resp = await request(`https://ghcr.io/token?scope=repository:${REPO}:pull&service=ghcr.io`)
  if (!resp.ok) {
    throw new Error(`anonymous token request failed: ${resp.status}`)
  }
  const body = (await resp.json()) as { token?: string }
  if (!body.token) throw new Error('token endpoint returned no token')
  return body.token
}

async function ghcrDigest(tag: string, request: Fetch): Promise<string> {
  const token = await bearerToken(request)
  const accept = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.docker.distribution.manifest.v2+json',
  ].join(',')
  const resp = await request(`https://ghcr.io/v2/${REPO}/manifests/${tag}`, {
    headers: { accept, authorization: `Bearer ${token}` },
  })
  if (!resp.ok) {
    throw new Error(`ghcr manifest fetch failed: ${resp.status} ${await resp.text()}`)
  }
  const digest = resp.headers.get('docker-content-digest')
  if (!digest) throw new Error('no docker-content-digest header')
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`unexpected digest format: ${digest}`)
  }
  return digest
}

function createTargets(tag: string): SyncTarget[] {
  const minor = tag.split('.').slice(0, 2).join('.')
  return [
    {
      path: 'deploy/k8s/deployment.yaml',
      pattern: /ghcr\.io\/iuliandita\/digarr@sha256:[a-f0-9]+/g,
      replacement: (d) => `ghcr.io/iuliandita/digarr@${d}`,
    },
    {
      path: 'deploy/helm/digarr/values.yaml',
      pattern: /(^image:\n(?: {2}.*\n)*? {2}digest: ")sha256:[a-f0-9]+(")/m,
      replacement: (d, _match, prefix, suffix) => `${prefix}${d}${suffix}`,
    },
    {
      path: 'deploy/k8s/rendered.yaml',
      pattern: /ghcr\.io\/iuliandita\/digarr@sha256:[a-f0-9]+/g,
      replacement: (d) => `ghcr.io/iuliandita/digarr@${d}`,
    },
    {
      path: 'deploy/unraid/digarr.xml',
      pattern: /(Digest pin \(synced via scripts\/sync-deploy-digests\.ts\): )sha256:[a-f0-9]+/,
      replacement: (d, _match, prefix) => `${prefix}${d}`,
    },
    // Version-tag pins. These close over `tag` (not the digest) so the visible
    // image reference stays in lockstep with the digest above. Without these the
    // tags freeze at whatever release first wrote them while the digest advances.
    {
      path: 'deploy/helm/digarr/values.yaml',
      pattern: /(^ {2}tag: ")[^"]+(")/m,
      replacement: (_d, _match, prefix, suffix) => `${prefix}${tag}${suffix}`,
    },
    {
      path: 'deploy/unraid/digarr.xml',
      pattern: /(<Repository>docker\.io\/iuliandita\/digarr:)[^<]+(<\/Repository>)/,
      replacement: (_d, _match, prefix, suffix) => `${prefix}${tag}${suffix}`,
    },
    {
      path: 'deploy/unraid/digarr.xml',
      pattern: /(<Tag>)[^<]+(<\/Tag>)/,
      replacement: (_d, _match, prefix, suffix) => `${prefix}${tag}${suffix}`,
    },
    {
      path: 'deploy/unraid/digarr.xml',
      pattern: /<TagDescription>[^<]*<\/TagDescription>/,
      replacement: () => `<TagDescription>v${tag} release</TagDescription>`,
    },
    // Example pins in compose comments and the README. Never the active image
    // (compose defaults to :latest), but stale examples read as the current
    // release to anyone copying them.
    {
      path: 'deploy/docker/docker-compose.yml',
      pattern: /(# {3}:)\d+\.\d+( -> current minor release line)/,
      replacement: (_d, _match, prefix, suffix) => `${prefix}${minor}${suffix}`,
    },
    {
      path: 'deploy/docker/docker-compose.yml',
      pattern: /(# image: docker\.io\/iuliandita\/digarr:)\d+\.\d+\.\d+/g,
      replacement: (_d, _match, prefix) => `${prefix}${tag}`,
    },
    {
      path: 'deploy/docker/docker-compose.pglite.yml',
      pattern: /(Track patch fixes only: docker\.io\/iuliandita\/digarr:)\d+\.\d+/,
      replacement: (_d, _match, prefix) => `${prefix}${minor}`,
    },
    {
      path: 'deploy/docker/docker-compose.pglite.yml',
      pattern: /(surprises: docker\.io\/iuliandita\/digarr:)\d+\.\d+\.\d+/,
      replacement: (_d, _match, prefix) => `${prefix}${tag}`,
    },
    {
      path: 'deploy/docker/docker-compose.pglite.yml',
      pattern: /(variant: docker\.io\/iuliandita\/digarr:)\d+\.\d+\.\d+(-debian)/,
      replacement: (_d, _match, prefix, suffix) => `${prefix}${tag}${suffix}`,
    },
    {
      path: 'README.md',
      pattern: /(minor tag like `:)\d+\.\d+(`)/,
      replacement: (_d, _match, prefix, suffix) => `${prefix}${minor}${suffix}`,
    },
    {
      path: 'README.md',
      pattern: /(specific patch like `:)\d+\.\d+\.\d+(`)/,
      replacement: (_d, _match, prefix, suffix) => `${prefix}${tag}${suffix}`,
    },
  ]
}

export function planTargetUpdates(
  targets: SyncTarget[],
  digest: string,
  readFile: (path: string) => string,
): Map<string, string> {
  const errors: string[] = []
  const updates = new Map<string, string>()
  for (const target of targets) {
    const content = updates.get(target.path) ?? readFile(target.path)
    target.pattern.lastIndex = 0
    if (!target.pattern.test(content)) {
      errors.push(`no match in ${target.path} - file format changed?`)
      continue
    }
    target.pattern.lastIndex = 0
    const updated = content.replace(target.pattern, (match, ...groups) =>
      target.replacement(digest, match, ...groups),
    )
    updates.set(target.path, updated)
  }

  if (errors.length > 0) throw new Error(errors.join('\n'))
  return updates
}

export function applyTargetUpdates(
  targets: SyncTarget[],
  digest: string,
  readFile: (path: string) => string,
  writeFile: (path: string, content: string) => void,
): void {
  const updates = planTargetUpdates(targets, digest, readFile)
  for (const [path, content] of updates) writeFile(path, content)
}

export async function syncDeployDigests(overrides: Partial<SyncDeps> = {}): Promise<void> {
  const deps: SyncDeps = {
    tagArg: process.argv[2],
    fetch,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: writeFileSync,
    log: console.log,
    ...overrides,
  }
  const tag = parseReleaseTag(deps.tagArg)
  const digest = await ghcrDigest(tag, deps.fetch)
  deps.log(`digest for ${tag}: ${digest}`)
  applyTargetUpdates(createTargets(tag), digest, deps.readFile, (path, content) => {
    deps.writeFile(path, content)
    deps.log(`updated ${path}`)
  })
}

if (import.meta.main) {
  await syncDeployDigests().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
