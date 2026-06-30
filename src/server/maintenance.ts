import type { MiddlewareHandler } from 'hono'

let active = false

export function setMaintenance(on: boolean): void {
  active = on
}

export function isMaintenance(): boolean {
  return active
}

// Mutating methods blocked during migration; reads pass through. The migration
// endpoints are exempt so the operator can drive and inspect the migration
// while writes on all other routes are suspended.
const EXEMPT_PREFIXES = ['/api/v1/admin/migrate-backend']
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export const maintenanceMiddleware: MiddlewareHandler = async (c, next) => {
  if (
    active &&
    WRITE_METHODS.has(c.req.method) &&
    !EXEMPT_PREFIXES.some((p) => c.req.path.startsWith(p))
  ) {
    return c.json(
      {
        error: 'Maintenance in progress (backend migration). Writes are temporarily disabled.',
        code: 'maintenance' as const,
      },
      503,
    )
  }
  return next()
}
