import type { MiddlewareHandler } from 'hono'
import { isMaintenance } from '@/core/ops/maintenance'
import { problem } from '@/server/helpers/problem'

export { isMaintenance, setMaintenance } from '@/core/ops/maintenance'

// Mutating methods blocked during migration; reads pass through. The migration
// endpoints are exempt so the operator can drive and inspect the migration
// while writes on all other routes are suspended.
const EXEMPT_PREFIXES = ['/api/v1/admin/migrate-backend']
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export const maintenanceMiddleware: MiddlewareHandler = async (c, next) => {
  if (
    isMaintenance() &&
    WRITE_METHODS.has(c.req.method) &&
    !EXEMPT_PREFIXES.some((p) => c.req.path === p || c.req.path.startsWith(`${p}/`))
  ) {
    return problem(
      c,
      'maintenance',
      'Maintenance in progress',
      503,
      'Backend migration is active. Writes are temporarily disabled.',
      undefined,
      'maintenance',
    )
  }
  return next()
}
