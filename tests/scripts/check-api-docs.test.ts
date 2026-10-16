// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  compareAdminAuth,
  compareRouteDocs,
  extractAdminPrefixes,
  extractAdminRoutes,
  extractDocumentedAuth,
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

  it('detects admin guards in route arguments, handlers, and prefix middleware', () => {
    const source = `
      app.use('/api/v1/admin/*', adminGuard(getUser))
      router.get('/api/v1/stats', adminGuard(getUser), async (c) => c.json({}))
      router.post('/api/v1/gate', async (c) => {
        const auth = await adminGate(c)
        return c.json({})
      })
      router.get('/api/v1/open', async (c) => c.json({}))
      router.get('/api/v1/admin/tools', async (c) => c.json({}))
    `

    const admin = extractAdminRoutes(source, extractAdminPrefixes(source))
    expect([...admin].sort()).toEqual([
      'GET /api/v1/admin/tools',
      'GET /api/v1/stats',
      'POST /api/v1/gate',
    ])
  })

  it('fails a wrong Auth cell in either direction', () => {
    const markdown = `
      | GET | \`/api/v1/stats\` | Yes | Guarded in code, documented as Yes |
      | GET | \`/api/v1/open\` | Admin | Open in code, documented as Admin |
      | POST | \`/api/v1/gate\` | Admin, or owner | Fine |
    `

    const result = compareAdminAuth(
      new Set(['GET /api/v1/stats', 'POST /api/v1/gate']),
      extractDocumentedAuth(markdown),
    )

    expect(result.missingAdmin).toEqual(['GET /api/v1/stats (documented: Yes)'])
    expect(result.unguardedAdmin).toEqual(['GET /api/v1/open'])
  })
})
