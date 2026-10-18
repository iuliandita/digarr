import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { errMsg } from '@/core/validation'
import {
  type ApprovalPolicy,
  type UserApprovalSettings,
  updateUserApprovalSettings,
} from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Field } from './field'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select } from './ui/select'

export function UserApprovalPolicyFields({
  value,
  onChange,
  id,
}: {
  value: UserApprovalSettings
  onChange: (value: UserApprovalSettings) => void
  id: string
}) {
  const { t } = useI18n()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field id={`${id}-policy`} label={t('approvalRequests.policy')}>
        <Select
          id={`${id}-policy`}
          value={value.approvalPolicy}
          onChange={(event) =>
            onChange({ ...value, approvalPolicy: event.target.value as ApprovalPolicy })
          }
        >
          <option value="direct">{t('approvalRequests.direct')}</option>
          <option value="request_only">{t('approvalRequests.requestOnly')}</option>
          <option value="auto_approve">{t('approvalRequests.autoApprove')}</option>
        </Select>
      </Field>
      <Field id={`${id}-limit`} label={t('approvalRequests.maxOpen')}>
        <Input
          id={`${id}-limit`}
          type="number"
          min={0}
          step={1}
          value={value.maxOpenRequests ?? ''}
          placeholder={t('approvalRequests.unlimited')}
          onChange={(event) =>
            onChange({
              ...value,
              maxOpenRequests: event.target.value === '' ? null : Number(event.target.value),
            })
          }
        />
      </Field>
      {value.approvalPolicy === 'auto_approve' && (
        <Field id={`${id}-threshold`} label={t('approvalRequests.threshold')}>
          <Input
            id={`${id}-threshold`}
            type="number"
            min={0}
            max={100}
            step={1}
            value={value.approvalThreshold == null ? '' : Math.round(value.approvalThreshold * 100)}
            placeholder={t('approvalRequests.thresholdDefault')}
            onChange={(event) =>
              onChange({
                ...value,
                approvalThreshold:
                  event.target.value === '' ? null : Number(event.target.value) / 100,
              })
            }
          />
        </Field>
      )}
    </div>
  )
}

export function UserApprovalPolicy({
  user,
}: {
  user: { id: number; username: string } & Partial<UserApprovalSettings>
}) {
  const { t } = useI18n()
  const client = useQueryClient()
  const [value, setValue] = useState<UserApprovalSettings>({
    approvalPolicy: user.approvalPolicy ?? 'direct',
    maxOpenRequests: user.maxOpenRequests ?? null,
    approvalThreshold: user.approvalThreshold ?? null,
  })
  const save = useMutation({
    mutationFn: () => updateUserApprovalSettings(user.id, value),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['users'] })
      toast.success(t('settings.saved'))
    },
    onError: (error) => toast.error(errMsg(error)),
  })
  return (
    <form
      aria-label={`${t('approvalRequests.policy')} - ${user.username}`}
      className="w-full space-y-3 border-t border-border pt-3"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <UserApprovalPolicyFields value={value} onChange={setValue} id={`user-${user.id}`} />
      <Button size="sm" type="submit" variant="outline" disabled={save.isPending}>
        {t('common.save')}
      </Button>
    </form>
  )
}
