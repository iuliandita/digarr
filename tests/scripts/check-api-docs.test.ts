// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  compareRouteDocs,
  extractDocumentedPaths,
  extractRouteDeclarations,
  normalizePath,
} from '../../scripts/check-api-docs'

describe('API docs drift checker', () => {
  it('extracts literal route declarations across single and multi-line handlers', () => {
    const source = `
      router.get('/api/v1/users', async (c) => c.json([]))
      router.patch(
        '/api/v1/users/:id',
        zParam(userIdParamSchema),
        async (c) => c.body(null, 204),
      )
      app.get('/health', async (c) => c.text('ok'))
      app.get('*', serveStatic({ root: webRoot }))
    `

    expect(extractRouteDeclarations(source)).toEqual([
      { method: 'GET', path: '/api/v1/users' },
      { method: 'PATCH', path: '/api/v1/users/:id' },
      { method: 'GET', path: '/health' },
    ])
  })

  it('normalizes query examples and alternate parameter notation', () => {
    expect(normalizePath('/api/v1/users/{id}?include=roles')).toBe('/api/v1/users/:id')
    expect(normalizePath('/api/v1/users/:id/')).toBe('/api/v1/users/:id')
  })

  it('extracts documented path-method pairs from markdown tables', () => {
    const markdown = `
      | Method | Path | Auth | Description |
      |--------|------|------|-------------|
      | GET | \`/api/v1/users\` | Admin | List all users |
      | PATCH | \`/api/v1/users/:id\` | Admin | Update user |
    `

    expect(extractDocumentedPaths(markdown)).toEqual([
      { method: 'GET', path: '/api/v1/users' },
      { method: 'PATCH', path: '/api/v1/users/:id' },
    ])
  })

  it('reports real undocumented routes and stale documented routes', () => {
    const issues = compareRouteDocs(
      [
        { method: 'GET', path: '/api/v1/users' },
        { method: 'POST', path: '/api/v1/users' },
      ],
      [
        { method: 'GET', path: '/api/v1/users' },
        { method: 'DELETE', path: '/api/v1/users/:id' },
      ],
    )

    expect(issues.undocumented).toEqual([{ method: 'POST', path: '/api/v1/users' }])
    expect(issues.stale).toEqual([{ method: 'DELETE', path: '/api/v1/users/:id' }])
  })
})
