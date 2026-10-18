import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import { errMsg } from '@/core/validation'
import { listApprovalRequests, listOwnApprovalRequests, resolveApprovalRequest } from '../lib/api'
import { reportApprovalOutcome } from '../lib/approval'
import { useI18n } from '../lib/i18n'
import { Button } from './ui/button'
import { Input } from './ui/input'

const STATUS_KEYS = {
  pending: 'approvalRequests.pending',
  approved: 'approvalRequests.approved',
  declined: 'approvalRequests.declined',
} as const satisfies Record<string, MessageKey>

export function ApprovalRequests({ admin = false }: { admin?: boolean }) {
  const { t } = useI18n()
  const client = useQueryClient()
  const [notes, setNotes] = useState<Record<number, string>>({})
  const query = useQuery({
    queryKey: ['approval-requests', admin ? 'queue' : 'mine'],
    queryFn: admin ? listApprovalRequests : listOwnApprovalRequests,
    refetchInterval: 30_000,
  })
  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: 'approve' | 'decline' }) =>
      resolveApprovalRequest(id, decision, notes[id]?.trim() || undefined),
    onSuccess: (result, variables) => {
      if (
        variables.decision === 'decline' ||
        !result.approval ||
        reportApprovalOutcome(result.approval, t)
      ) {
        toast.success(t('approvalRequests.resolved'))
      }
      void client.invalidateQueries({ queryKey: ['approval-requests'] })
      void client.invalidateQueries({ queryKey: ['recommendations'] })
      for (const key of [
        'dashboard-approved',
        'dashboard-pick',
        'dashboard-activity',
        'recommendation-counts',
      ]) {
        void client.invalidateQueries({ queryKey: [key] })
      }
    },
    onError: (error) => toast.error(errMsg(error)),
  })
  const requests = (query.data ?? []).filter((request) => admin || request.status !== 'approved')
  const pendingCount = requests.filter((request) => request.status === 'pending').length

  if (!admin && !query.error && requests.length === 0) return null

  return (
    <section className="space-y-3" aria-label={t('approvalRequests.title')}>
      <h2 className="text-lead font-semibold text-text flex items-center gap-2">
        {t('approvalRequests.title')}
        {admin && (
          <span className="rounded bg-accent/10 px-2 py-0.5 text-sm text-accent-text">
            {pendingCount}
          </span>
        )}
      </h2>
      {query.isLoading && (
        <p className="text-sm text-muted" role="status">
          {t('common.loading')}
        </p>
      )}
      {query.error && (
        <p className="text-sm text-reject" role="alert">
          {errMsg(query.error)}
        </p>
      )}
      {!query.isLoading && !query.error && requests.length === 0 && (
        <p className="text-sm text-muted">{t('approvalRequests.empty')}</p>
      )}
      {requests.map((request) => (
        <article
          key={request.id}
          className="rounded-lg border border-border bg-surface p-4 space-y-2"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="font-medium text-text">
              {request.recommendation.artistName}
              {request.recommendation.albumTitle && ` - ${request.recommendation.albumTitle}`}
            </h3>
            <span className="text-sm text-muted">{t(STATUS_KEYS[request.status])}</span>
          </div>
          {admin && (
            <p className="text-sm text-muted">
              {t('approvalRequests.requester')}: {request.requester.username}
            </p>
          )}
          <p className="text-sm text-muted">
            {t('approvalRequests.score')}: {Math.round(request.recommendation.score * 100)}%
          </p>
          {[...new Set(request.recommendation.reasons)].map((reason) => (
            <p key={reason} className="text-sm text-text whitespace-pre-wrap">
              {reason}
            </p>
          ))}
          {request.note && (
            <p className="text-sm text-text whitespace-pre-wrap">
              {t('approvalRequests.note')}: {request.note}
            </p>
          )}
          {admin && request.status === 'pending' && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                resolve.mutate({ id: request.id, decision: 'approve' })
              }}
              className="space-y-2"
            >
              <label
                htmlFor={`request-note-${request.id}`}
                className="block space-y-1 text-sm text-muted"
              >
                <span>{t('approvalRequests.optionalNote')}</span>
                <Input
                  id={`request-note-${request.id}`}
                  maxLength={1000}
                  value={notes[request.id] ?? ''}
                  onChange={(event) =>
                    setNotes((previous) => ({ ...previous, [request.id]: event.target.value }))
                  }
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" type="submit" disabled={resolve.isPending}>
                  {t('approvalRequests.approve')}
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: request.id, decision: 'decline' })}
                >
                  {t('approvalRequests.decline')}
                </Button>
              </div>
            </form>
          )}
        </article>
      ))}
    </section>
  )
}
