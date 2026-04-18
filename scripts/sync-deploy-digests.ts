#!/usr/bin/env bun
/**
 * Sync image digest across deploy artefacts (k8s, Helm, Unraid).
 *
 * Usage: bun scripts/sync-deploy-digests.ts <tag>
 *   <tag> may be "v0.32.3" or "0.32.3" (leading "v" stripped).
 *
 * Fetches the multi-arch manifest digest from ghcr.io and rewrites:
 *   - deploy/k8s/deployment.yaml      (image ref with @sha256:...)
 *   - deploy/helm/digarr/values.yaml  (digest: "sha256:...")
 *   - deploy/unraid/digarr.xml        (digest comment)
 *
 * Auth: tries GH_TOKEN env first; falls back to anonymous token (public images).
 */

import { readFileSync, writeFileSync } from 'node:fs'

const REPO = 'iuliandita/digarr'

const tagArg = process.argv[2]
if (!tagArg) {
  console.error('usage: bun scripts/sync-deploy-digests.ts <tag>')
  process.exit(1)
}
const tag = tagArg.replace(/^v/, '')

async function bearerToken(): Promise<string> {
  if (process.env.GH_TOKEN) {
    return Buffer.from(`v1:${process.env.GH_TOKEN}`).toString('base64')
  }
  const resp = await fetch(`https://ghcr.io/token?scope=repository:${REPO}:pull&service=ghcr.io`)
  if (!resp.ok) {
    throw new Error(`anonymous token request failed: ${resp.status}`)
  }
  const body = (await resp.json()) as { token?: string }
  if (!body.token) throw new Error('token endpoint returned no token')
  return body.token
}

async function ghcrDigest(tag: string): Promise<string> {
  const token = await bearerToken()
  const accept = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.docker.distribution.manifest.v2+json',
  ].join(',')
  const resp = await fetch(`https://ghcr.io/v2/${REPO}/manifests/${tag}`, {
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

type Target = {
  path: string
  pattern: RegExp
  replacement: (digest: string) => string
}

const digest = await ghcrDigest(tag)
console.log(`digest for ${tag}: ${digest}`)

const targets: Target[] = [
  {
    path: 'deploy/k8s/deployment.yaml',
    pattern: /ghcr\.io\/iuliandita\/digarr@sha256:[a-f0-9]+/g,
    replacement: (d) => `ghcr.io/iuliandita/digarr@${d}`,
  },
  {
    path: 'deploy/helm/digarr/values.yaml',
    pattern: /sha256:[a-f0-9]+/g,
    replacement: (d) => d,
  },
  {
    path: 'deploy/unraid/digarr.xml',
    pattern: /sha256:[a-f0-9]+/g,
    replacement: (d) => d,
  },
]

let drift = false
for (const t of targets) {
  const content = readFileSync(t.path, 'utf8')
  if (!t.pattern.test(content)) {
    console.error(`no digest match in ${t.path} - file format changed?`)
    drift = true
    continue
  }
  t.pattern.lastIndex = 0
  const updated = content.replace(t.pattern, t.replacement(digest))
  writeFileSync(t.path, updated)
  console.log(`updated ${t.path}`)
}

if (drift) process.exit(1)
