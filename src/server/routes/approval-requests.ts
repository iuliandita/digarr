import { type Context, Hono } from 'hono'
import { notifyRequestResolved } from '@/core/notifications/request-resolved'
import {
  ApprovalRequestNotFoundError,
  approvalRequestQueries,
} from '@/db/queries/approval-requests'
import type { AppDependencies } from '@/server'
import { problem } from '@/server/helpers/problem'
import { requireSessionUser } from '@/server/helpers/require-user'
import { adminGuard } from '@/server/middleware/admin-guard'
import {
  approvalRequestDecisionSchema,
  approvalRequestIdSchema,
} from '@/server/schemas/approval-requests'
import { zJson, zParam } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'
import { executeRequestedApproval } from './recommendations'

class ApprovalExecutionError extends Error {
  constructor(readonly response: Response) {
    super('Approval could not be executed')
  }
}

export function approvalRequestRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()
  const queries = deps.approvalRequests ?? approvalRequestQueries(deps.db)

  router.get('/api/v1/approval-requests/mine', async (c) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response
    return c.json(await queries.list(auth.userId))
  })
  router.get('/api/v1/approval-requests', adminGuard(deps.getUserById), async (c) =>
    c.json(await queries.list()),
  )

  const decide = async (
    c: Context<HonoEnv>,
    action: 'approve' | 'decline',
    id: number,
    note?: string | null,
  ) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response
    let approval: Record<string, unknown> | undefined
    try {
      const result = await queries.decide(
        id,
        auth.userId,
        action === 'approve' ? 'approved' : 'declined',
        note ?? null,
        async (request) => {
          const response = await executeRequestedApproval(
            deps,
            request.userId,
            request.recommendationId,
            request.options,
          )
          if (!response.ok) throw new ApprovalExecutionError(response)
          approval = (await response.json()) as Record<string, unknown>
        },
      )
      if (result.changed) {
        const notify = async () => {
          if (deps.notifyApprovalRequestResolved)
            return deps.notifyApprovalRequestResolved(result.request)
          const [user, rec] = await Promise.all([
            deps.getUserById(result.request.userId),
            deps.getRecommendation(result.request.recommendationId),
          ])
          if (user && rec)
            await notifyRequestResolved(user, {
              recommendationId: rec.id,
              artistName: rec.artist.name,
              status: result.request.status === 'approved' ? 'approved' : 'declined',
            })
        }
        void notify().catch((error) =>
          console.error('[approval-requests] Notification failed:', error),
        )
      }
      return c.json({ request: result.request, ...(approval ? { approval } : {}) })
    } catch (error) {
      if (error instanceof ApprovalRequestNotFoundError)
        return problem(
          c,
          'approval-request-not-found',
          'Approval request not found',
          404,
          undefined,
          undefined,
          'errors.approval.notFound',
        )
      if (error instanceof ApprovalExecutionError) return error.response
      throw error
    }
  }
  router.post(
    '/api/v1/approval-requests/:id/approve',
    adminGuard(deps.getUserById),
    zParam(approvalRequestIdSchema),
    zJson(approvalRequestDecisionSchema),
    async (c) => decide(c, 'approve', c.req.valid('param').id, c.req.valid('json').note),
  )
  router.post(
    '/api/v1/approval-requests/:id/decline',
    adminGuard(deps.getUserById),
    zParam(approvalRequestIdSchema),
    zJson(approvalRequestDecisionSchema),
    async (c) => decide(c, 'decline', c.req.valid('param').id, c.req.valid('json').note),
  )
  return router
}
