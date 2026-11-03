import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BUNDLE_NAME = 'redoc.standalone.js'
const BUNDLE_SOURCES = [
  ['dist', 'api-docs', BUNDLE_NAME],
  ['node_modules', 'redoc', 'bundles', BUNDLE_NAME],
]

// The sidebar footer loads this image from a third-party CDN, and no Redoc option turns it off.
const REMOTE_LOGO = 'https://cdn.redoc.ly/redoc/logo-mini.svg'
const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

export const API_DOCS_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export const API_DOCS_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>digarr API</title>
<link rel="icon" href="data:,">
<style>body{margin:0}</style>
</head>
<body>
<redoc spec-url="/api/v1/docs/openapi.json" hide-hostname="true" expand-responses="200,201,204" theme='{"typography":{"fontFamily":"system-ui, -apple-system, \\"Segoe UI\\", Roboto, sans-serif","headings":{"fontFamily":"system-ui, -apple-system, \\"Segoe UI\\", Roboto, sans-serif"}}}'></redoc>
<noscript>This page needs JavaScript. The raw specification is at <a href="/api/v1/docs/openapi.json">/api/v1/docs/openapi.json</a>.</noscript>
<script src="/api/v1/docs/${BUNDLE_NAME}"></script>
</body>
</html>
`

let cached: string | undefined

export function loadApiDocsBundle(cwd = process.cwd()): string {
  if (cached) return cached
  let lastError: unknown
  for (const parts of BUNDLE_SOURCES) {
    let source: string
    try {
      source = readFileSync(resolve(cwd, ...parts), 'utf8')
    } catch (err) {
      lastError = err
      continue
    }
    if (!source.includes(REMOTE_LOGO)) {
      throw new Error('API reference viewer bundle changed: remote logo marker not found')
    }
    cached = source.replaceAll(REMOTE_LOGO, BLANK_IMAGE)
    return cached
  }
  throw new Error(`API reference viewer bundle not found: ${String(lastError)}`)
}
