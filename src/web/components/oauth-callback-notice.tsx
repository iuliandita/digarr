import { CheckCircle2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { MessageKey } from '@/core/i18n/messages/types'
import { useI18n } from '../lib/i18n'

const ERROR_MESSAGE_KEYS = {
  missing_code_or_state: 'oauth.error.missingCodeOrState',
  no_pending_auth: 'oauth.error.noPendingAuth',
  state_expired: 'oauth.error.stateExpired',
  browser_mismatch: 'oauth.error.browserMismatch',
  missing_credentials: 'oauth.error.missingCredentials',
  token_exchange_unreachable: 'oauth.error.tokenExchangeUnreachable',
  token_exchange_failed: 'oauth.error.tokenExchangeFailed',
  token_exchange_malformed: 'oauth.error.tokenExchangeMalformed',
  token_exchange_no_token: 'oauth.error.tokenExchangeNoToken',
  unknown_provider: 'oauth.error.unknownProvider',
} as const satisfies Record<string, MessageKey>

const PROVIDER_LABELS = {
  spotify: 'Spotify',
  deezer: 'Deezer',
  tidal: 'TIDAL',
} as const

export type OAuthNotice =
  | { kind: 'success'; providerLabel: string }
  | { kind: 'error'; messageKey: MessageKey; rawCode: string | null }

const MAX_RAW_CODE_LENGTH = 64

// The provider pass-through case puts provider-controlled text in the URL, so an
// unrecognized value is only ever echoed back as inert, length-capped plain text.
function sanitizeRawCode(value: string): string | null {
  const cleaned = value.replace(/[^\w.: -]/g, '').trim()
  if (!cleaned) return null
  return cleaned.slice(0, MAX_RAW_CODE_LENGTH)
}

export function resolveOAuthNotice(params: {
  error?: string | null
  success?: string | null
}): OAuthNotice | null {
  const { error, success } = params

  if (error) {
    const messageKey = ERROR_MESSAGE_KEYS[error as keyof typeof ERROR_MESSAGE_KEYS]
    if (messageKey) return { kind: 'error', messageKey, rawCode: null }
    return { kind: 'error', messageKey: 'oauth.error.generic', rawCode: sanitizeRawCode(error) }
  }

  if (success) {
    const providerLabel = PROVIDER_LABELS[success as keyof typeof PROVIDER_LABELS]
    if (providerLabel) return { kind: 'success', providerLabel }
  }

  return null
}

export function OAuthCallbackNotice() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const consumed = useRef(false)
  const [notice, setNotice] = useState<OAuthNotice | null>(() =>
    resolveOAuthNotice({
      error: searchParams.get('oauth_error'),
      success: searchParams.get('oauth_success'),
    }),
  )

  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    if (!searchParams.has('oauth_error') && !searchParams.has('oauth_success')) return

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('oauth_error')
    nextParams.delete('oauth_success')
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  if (!notice) return null

  const isError = notice.kind === 'error'

  return (
    <div
      role="status"
      className={`relative rounded-lg border px-4 py-4 ${
        isError ? 'border-reject/30 bg-reject/10' : 'border-accent/30 bg-accent/10'
      }`}
    >
      <button
        type="button"
        onClick={() => setNotice(null)}
        className="absolute top-3 right-3 text-muted hover:opacity-70 transition-opacity"
        aria-label={t('common.dismiss')}
      >
        <X size={14} />
      </button>
      <div className="flex gap-3 pr-6">
        {isError ? (
          <TriangleAlert size={18} className="shrink-0 text-reject" />
        ) : (
          <CheckCircle2 size={18} className="shrink-0 text-accent" />
        )}
        <div className="space-y-1">
          <div className="text-sm font-semibold text-text">
            {isError ? t('oauth.failedTitle') : t('oauth.connectedTitle')}
          </div>
          <div className="text-sm text-muted">
            {notice.kind === 'error'
              ? t(notice.messageKey)
              : t('oauth.connectedBody').replace('{0}', notice.providerLabel)}
          </div>
          {notice.kind === 'error' && notice.rawCode ? (
            <div className="text-xs text-muted">
              {t('oauth.error.codeLabel')}:{' '}
              <code className="font-mono text-text">{notice.rawCode}</code>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
