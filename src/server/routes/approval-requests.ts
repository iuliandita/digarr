import { type Context, Hono } from 'hono'
import { createTranslator } from '@/core/i18n/translator'
import { notifyRequestResolved } from '@/core/notifications/request-resolved'
import {
  ApprovalRequestExecutionError,
  ApprovalRequestNotFoundError,
  approvalRequestQueries,
} from '@/db/queries/approval-requests'
import type { AppDependencies } from '@/server'
import { problem } from '@/server/helpers/problem'
import { requireSessionUser } from '@/server/helpers/require-user'
import { resolveRequestLocale } from '@/server/locale'
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
          if (request.recommendationId === null) throw new ApprovalRequestNotFoundError()
          const response = await executeRequestedApproval(
            deps,
            request.userId,
            request.recommendationId,
            request.options,
          )
          if (!response.ok) throw new ApprovalExecutionError(response)
          approval = (await response.json()) as Record<string, unknown>
          if (!['added_to_lidarr', 'approved', 'waiting'].includes(String(approval.status)))
            throw new ApprovalRequestExecutionError(
              typeof approval.lidarrError === 'string'
                ? approval.lidarrError
                : createTranslator(
                    resolveRequestLocale({
                      requestLocale: c.req.header('X-Digarr-Locale'),
                      acceptLanguage: c.req.header('Accept-Language'),
                    }),
                  )('approvalRequests.error'),
            )
        },
      )
      if (result.changed) {
        const notify = async () => {
          if (deps.notifyApprovalRequestResolved)
            return deps.notifyApprovalRequestResolved(result.request)
          const [user, rec] = await Promise.all([
            deps.getUserById(result.request.userId),
            result.request.recommendationId === null
              ? Promise.resolve(null)
              : deps.getRecommendation(result.request.recommendationId),
          ])
          const snapshot = result.request.options._albumRequest as
            | { recommendationId: number; artistName: string }
            | undefined
          const subject = rec ? { recommendationId: rec.id, artistName: rec.artist.name } : snapshot
          if (user && subject)
            await notifyRequestResolved(user, {
              recommendationId: subject.recommendationId,
              artistName: subject.artistName,
              status: result.request.status === 'approved' ? 'approved' : 'declined',
              waiting: approval?.status === 'waiting',
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
