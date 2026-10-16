#!/usr/bin/env bun

/**
 * Check that docs/API.md lists the HTTP route surface declared in the server.
 *
 * Usage: bun scripts/check-api-docs.ts
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

type HttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

export type RouteDeclaration = {
  method: HttpMethod
  path: string
}

const SERVER_FILES = ['src/server/index.ts']
const ROUTE_DIR = 'src/server/routes'
const DOC_FILE = 'docs/API.md'
const METHOD_PATTERN = '(get|post|patch|delete|put)'
const ROUTE_DECLARATION_RE = new RegExp(
  `\\b(?:app|router)\\.${METHOD_PATTERN}\\s*\\(\\s*(['"\`])([^'"\`]+)\\2`,
  'g',
)

const MARKDOWN_TABLE_ROUTE_RE = /^\s*\|\s*(GET|POST|PATCH|DELETE|PUT)\s*\|\s*`([^`]+)`\s*\|/gim
const MARKDOWN_TABLE_AUTH_RE =
  /^\s*\|\s*(GET|POST|PATCH|DELETE|PUT)\s*\|\s*`([^`]+)`\s*\|\s*([^|]*?)\s*\|/gim

// Admin enforcement forms: an adminGuard middleware in the route's arguments, an
// adminGate()/requireAdmin() call or a negated inline resolveAdmin() in its handler,
// or a use() prefix guard (which may live in a different file than the route).
const ROUTE_ADMIN_RE =
  /\badminGuard\(|\bawait\s+(?:adminGate|requireAdmin)\(|!\s*\(\s*await\s+resolveAdmin\(/
const USE_DECLARATION_RE = /\b(?:app|router)\.use\s*\(/g
const PREFIX_ADMIN_RE = /\b(?:app|router)\.use\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*adminGuard\(/g

const IGNORED_ROUTES = new Set<string>([
  // Test-only route, registered only when NODE_ENV==='test' and tree-shaken out
  // of production builds. Not part of the public API surface, so not documented.
  'POST /api/v1/test/seed-recommendations',
])

function routeKey(route: RouteDeclaration): string {
  return `${route.method} ${route.path}`
}

function uniqueRoutes(routes: RouteDeclaration[]): RouteDeclaration[] {
  const seen = new Set<string>()
  const unique: RouteDeclaration[] = []
  for (const route of routes) {
    const key = routeKey(route)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(route)
  }
  return unique
}

export function normalizePath(path: string): string {
  const stripped = path.split('?')[0]?.trim() ?? ''
  const normalizedParams = stripped.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
  if (normalizedParams.length > 1 && normalizedParams.endsWith('/')) {
    return normalizedParams.slice(0, -1)
  }
  return normalizedParams
}

export function extractRouteDeclarations(source: string): RouteDeclaration[] {
  const routes: RouteDeclaration[] = []
  for (const match of source.matchAll(ROUTE_DECLARATION_RE)) {
    const method = match[1]?.toUpperCase() as HttpMethod | undefined
    const rawPath = match[3]
    if (!method || !rawPath?.startsWith('/')) continue
    const path = normalizePath(rawPath)
    if (path === '/*') continue
    routes.push({ method, path })
  }
  return uniqueRoutes(routes)
}

export function extractDocumentedPaths(markdown: string): RouteDeclaration[] {
  const routes: RouteDeclaration[] = []
  for (const match of markdown.matchAll(MARKDOWN_TABLE_ROUTE_RE)) {
    const method = match[1] as HttpMethod | undefined
    const rawPath = match[2]
    if (!method || !rawPath) continue
    routes.push({ method, path: normalizePath(rawPath) })
  }
  return uniqueRoutes(routes)
}

export function extractAdminPrefixes(source: string): string[] {
  return [...source.matchAll(PREFIX_ADMIN_RE)].map((match) => normalizePath(match[2] ?? ''))
}

export function extractAdminRoutes(source: string, prefixes: string[] = []): Set<string> {
  const matches = [...source.matchAll(ROUTE_DECLARATION_RE)]
  const useOffsets = [...source.matchAll(USE_DECLARATION_RE)].map((match) => match.index ?? 0)
  const admin = new Set<string>()
  matches.forEach((match, index) => {
    const method = match[1]?.toUpperCase() as HttpMethod | undefined
    const rawPath = match[3]
    if (!method || !rawPath?.startsWith('/')) return
    const path = normalizePath(rawPath)
    const start = match.index ?? 0
    const end = Math.min(
      matches[index + 1]?.index ?? source.length,
      useOffsets.find((offset) => offset > start) ?? source.length,
    )
    const prefixed = prefixes.some((prefix) =>
      prefix.endsWith('/*') ? path.startsWith(prefix.slice(0, -1)) : path === prefix,
    )
    if (prefixed || ROUTE_ADMIN_RE.test(source.slice(start, end))) {
      admin.add(routeKey({ method, path }))
    }
  })
  return admin
}

export function extractDocumentedAuth(markdown: string): Map<string, string> {
  const auth = new Map<string, string>()
  for (const match of markdown.matchAll(MARKDOWN_TABLE_AUTH_RE)) {
    const method = match[1] as HttpMethod | undefined
    const rawPath = match[2]
    if (!method || !rawPath) continue
    auth.set(routeKey({ method, path: normalizePath(rawPath) }), (match[3] ?? '').trim())
  }
  return auth
}

/**
 * Compare the Auth column with detectable admin guards. A route guarded in code
 * must be documented as Admin (or "Admin, ..." / "Admin or ..."); a route
 * documented as plain "Admin" must have a detectable guard.
 */
export function compareAdminAuth(
  adminRoutes: Set<string>,
  documentedAuth: Map<string, string>,
  ignoredRoutes: Set<string> = IGNORED_ROUTES,
): { missingAdmin: string[]; unguardedAdmin: string[] } {
  const missingAdmin: string[] = []
  const unguardedAdmin: string[] = []
  for (const [key, cell] of documentedAuth) {
    if (ignoredRoutes.has(key)) continue
    const documentedAdmin = /^Admin\b/i.test(cell)
    if (adminRoutes.has(key) && !documentedAdmin) missingAdmin.push(`${key} (documented: ${cell})`)
    if (!adminRoutes.has(key) && cell.toLowerCase() === 'admin') unguardedAdmin.push(key)
  }
  return { missingAdmin, unguardedAdmin }
}

export function compareRouteDocs(
  actualRoutes: RouteDeclaration[],
  documentedRoutes: RouteDeclaration[],
  ignoredRoutes: Set<string> = IGNORED_ROUTES,
): { undocumented: RouteDeclaration[]; stale: RouteDeclaration[] } {
  const actual = uniqueRoutes(actualRoutes).filter((route) => !ignoredRoutes.has(routeKey(route)))
  const documented = uniqueRoutes(documentedRoutes).filter(
    (route) => !ignoredRoutes.has(routeKey(route)),
  )
  const actualKeys = new Set(actual.map(routeKey))
  const documentedKeys = new Set(documented.map(routeKey))

  return {
    undocumented: actual.filter((route) => !documentedKeys.has(routeKey(route))),
    stale: documented.filter((route) => !actualKeys.has(routeKey(route))),
  }
}

function readServerRouteSources(): string[] {
  const routeFiles = readdirSync(ROUTE_DIR)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => join(ROUTE_DIR, name))

  return [...SERVER_FILES, ...routeFiles].map((path) => readFileSync(path, 'utf8'))
}

function formatRoutes(routes: RouteDeclaration[]): string {
  return routes.map((route) => `  - ${route.method} ${route.path}`).join('\n')
}

export function main(): void {
  const sources = readServerRouteSources()
  const doc = readFileSync(DOC_FILE, 'utf8')
  const actualRoutes = sources.flatMap(extractRouteDeclarations)
  const documentedRoutes = extractDocumentedPaths(doc)
  const { undocumented, stale } = compareRouteDocs(actualRoutes, documentedRoutes)
  const prefixes = sources.flatMap(extractAdminPrefixes)
  const adminRoutes = new Set(
    sources.flatMap((source) => [...extractAdminRoutes(source, prefixes)]),
  )
  const { missingAdmin, unguardedAdmin } = compareAdminAuth(adminRoutes, extractDocumentedAuth(doc))

  if (missingAdmin.length > 0) {
    console.error('Admin-guarded routes whose Auth column does not say Admin:')
    console.error(missingAdmin.map((entry) => `  - ${entry}`).join('\n'))
  }
  if (unguardedAdmin.length > 0) {
    console.error('Routes documented as Admin with no detectable admin guard:')
    console.error(unguardedAdmin.map((entry) => `  - ${entry}`).join('\n'))
  }
  const authFailed = missingAdmin.length > 0 || unguardedAdmin.length > 0

  if (undocumented.length === 0 && stale.length === 0) {
    if (authFailed) process.exit(1)
    console.log(`API docs cover ${uniqueRoutes(actualRoutes).length} route declarations.`)
    return
  }

  if (undocumented.length > 0) {
    console.error('Undocumented API routes:')
    console.error(formatRoutes(undocumented))
  }
  if (stale.length > 0) {
    console.error('Documented API routes not found in server declarations:')
    console.error(formatRoutes(stale))
  }
  process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
