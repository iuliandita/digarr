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
  const actualRoutes = readServerRouteSources().flatMap(extractRouteDeclarations)
  const documentedRoutes = extractDocumentedPaths(readFileSync(DOC_FILE, 'utf8'))
  const { undocumented, stale } = compareRouteDocs(actualRoutes, documentedRoutes)

  if (undocumented.length === 0 && stale.length === 0) {
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
