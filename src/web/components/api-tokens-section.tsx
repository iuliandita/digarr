import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { errMsg } from '@/core/validation'
import { createApiToken, listApiTokens, type PersonalApiToken, revokeApiToken } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { ConfirmDialog } from './confirm-dialog'
import { Field } from './field'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select } from './ui/select'

export function ApiTokensSection({ isAdmin }: { isAdmin: boolean }) {
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const {
    data: tokens,
    isPending,
    error,
  } = useQuery({ queryKey: ['apiTokens'], queryFn: listApiTokens })
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<PersonalApiToken['scope']>('read')
  const [expiry, setExpiry] = useState<30 | 90 | 365 | null>(null)
  const [secret, setSecret] = useState('')
  const mcpConfig = secret
    ? JSON.stringify(
        {
          mcpServers: {
            digarr: {
              type: 'http',
              url: `${window.location.origin}/api/v1/mcp`,
              headers: { Authorization: `Bearer ${secret}` },
            },
          },
        },
        null,
        2,
      )
    : ''
  const [busy, setBusy] = useState(false)
  const [revoking, setRevoking] = useState<PersonalApiToken | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const createButton = useRef<HTMLButtonElement>(null)
  const scopeLabels = { read: t('tokens.read'), write: t('tokens.write'), admin: t('tokens.admin') }
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale) : t('common.never')

  useEffect(() => {
    if (open) dialog.current?.showModal()
  }, [open])

  function close() {
    dialog.current?.close()
    setOpen(false)
    setSecret('')
    createButton.current?.focus()
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const result = await createApiToken({ name, scope, expiresInDays: expiry })
      setSecret(result.token)
      await client.invalidateQueries({ queryKey: ['apiTokens'] })
    } catch (error) {
      toast.error(errMsg(error))
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!revoking || busy) return
    setBusy(true)
    try {
      await revokeApiToken(revoking.id)
      setRevoking(null)
      await client.invalidateQueries({ queryKey: ['apiTokens'] })
    } catch (error) {
      toast.error(errMsg(error))
    } finally {
      setBusy(false)
    }
  }

  async function copy(configuration = false) {
    try {
      await navigator.clipboard.writeText(configuration ? mcpConfig : secret)
      toast.success(t(configuration ? 'tokens.mcpCopied' : 'tokens.copied'))
    } catch {
      toast.error(t(configuration ? 'tokens.mcpCopyFailed' : 'tokens.copyFailed'))
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lead font-semibold text-text">{t('tokens.title')}</h2>
      <p className="text-sm text-muted">{t('tokens.description')}</p>
      <p className="text-sm text-muted">{t('tokens.passwordWarning')}</p>
      {isPending && <p role="status">{t('common.loading')}</p>}
      {error && (
        <p role="alert" className="text-sm text-muted">
          {errMsg(error)}
        </p>
      )}
      {tokens?.length === 0 && <p className="text-sm text-muted">{t('tokens.empty')}</p>}
      <ul className="space-y-3">
        {tokens?.map((token) => (
          <li key={token.id} className="rounded-lg border border-border bg-surface p-3 space-y-2">
            <p className="font-medium text-text break-words">{token.name}</p>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-muted">{t('tokens.prefix')}</dt>
              <dd className="font-mono">{token.prefix}...</dd>
              <dt className="text-muted">{t('tokens.scope')}</dt>
              <dd>{scopeLabels[token.scope]}</dd>
              <dt className="text-muted">{t('tokens.created')}</dt>
              <dd>{date(token.createdAt)}</dd>
              <dt className="text-muted">{t('tokens.lastUsed')}</dt>
              <dd>{date(token.lastUsedAt)}</dd>
              <dt className="text-muted">{t('tokens.expires')}</dt>
              <dd>{date(token.expiresAt)}</dd>
            </dl>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => setRevoking(token)}
            >
              {t('tokens.revoke')}
            </Button>
          </li>
        ))}
      </ul>
      <Button
        ref={createButton}
        variant="outline"
        onClick={() => {
          setName('')
          setScope('read')
          setExpiry(null)
          setSecret('')
          setOpen(true)
        }}
      >
        {t('tokens.create')}
      </Button>
      {open && (
        <dialog
          ref={dialog}
          aria-labelledby="api-token-dialog-title"
          onCancel={(e) => {
            e.preventDefault()
            if (!busy) close()
          }}
          className="m-auto w-full max-w-md rounded-lg border border-border bg-surface p-5 text-text backdrop:bg-bg/70"
        >
          <h3 id="api-token-dialog-title" className="text-lead font-semibold mb-3">
            {t('tokens.create')}
          </h3>
          {secret ? (
            <div className="space-y-3">
              <p role="status" className="text-sm text-muted">
                {t('tokens.revealWarning')}
              </p>
              <Input
                aria-label={t('tokens.title')}
                value={secret}
                readOnly
                onFocus={(e) => e.target.select()}
                className="font-mono"
              />
              <Button onClick={() => copy()}>{t('tokens.copy')}</Button>
              <h4 id="mcp-client-config-title" className="font-medium">
                {t('tokens.mcpTitle')}
              </h4>
              <p className="text-sm text-muted">{t('tokens.mcpDescription')}</p>
              <section aria-labelledby="mcp-client-config-title">
                <pre className="overflow-x-auto rounded border border-border p-3 text-xs">
                  <code>{mcpConfig}</code>
                </pre>
              </section>
              <Button onClick={() => copy(true)}>{t('tokens.mcpCopy')}</Button>
              <Button variant="outline" disabled={busy} onClick={close}>
                {t('common.close')}
              </Button>
            </div>
          ) : (
            <form onSubmit={create} className="space-y-3">
              <Field label={t('settings.name')} id="api-token-name">
                <Input
                  id="api-token-name"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
              </Field>
              <Field label={t('tokens.scope')} id="api-token-scope">
                <Select
                  id="api-token-scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as PersonalApiToken['scope'])}
                  disabled={busy}
                >
                  <option value="read">{scopeLabels.read}</option>
                  <option value="write">{scopeLabels.write}</option>
                  {isAdmin && <option value="admin">{scopeLabels.admin}</option>}
                </Select>
              </Field>
              <Field label={t('tokens.expires')} id="api-token-expiry">
                <Select
                  id="api-token-expiry"
                  value={expiry ?? ''}
                  onChange={(e) =>
                    setExpiry(e.target.value ? (Number(e.target.value) as 30 | 90 | 365) : null)
                  }
                  disabled={busy}
                >
                  <option value="">{t('common.never')}</option>
                  {[30, 90, 365].map((days) => (
                    <option key={days} value={days}>
                      {t('tokens.days').replace('{days}', String(days))}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy ? t('common.loading') : t('common.create')}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={close}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          )}
        </dialog>
      )}
      {revoking && (
        <ConfirmDialog
          title={t('tokens.revoke')}
          message={t('tokens.revokeConfirm').replace('{name}', revoking.name)}
          confirmLabel={t('tokens.revoke')}
          onConfirm={revoke}
          onCancel={() => {
            if (!busy) setRevoking(null)
          }}
          fallbackFocusRef={createButton}
        />
      )}
    </section>
  )
}
