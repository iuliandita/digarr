import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { MessageKey } from '@/core/i18n/messages/types'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../lib/i18n'

export type ConnectionChoice = {
  id: string
  name: string
  description: MessageKey
  group: MessageKey
  icon: ReactNode
  experimental?: boolean
}

export function ConnectionPicker({
  choices,
  onPick,
  onClose,
  experimental,
  onExperimentalChange,
  saving,
}: {
  choices: ConnectionChoice[]
  onPick: (id: string) => void
  onClose: () => void
  experimental: boolean
  onExperimentalChange?: (value: boolean) => void
  saving: boolean
}) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    searchRef.current?.focus()
  }, [])
  const filtered = choices.filter((choice) =>
    `${choice.name} ${t(choice.description)} ${t(choice.group)}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  )
  const groups = [...new Set(filtered.map((choice) => choice.group))]

  return (
    <section
      id="connection-picker"
      aria-label={t('settings.addConnection')}
      className="space-y-4 rounded-surface border border-border bg-surface p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex items-center gap-3">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
        <Input
          ref={searchRef}
          type="search"
          aria-label={t('settings.searchConnections')}
          placeholder={t('settings.searchConnections')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button variant="ghost" size="icon" aria-label={t('common.close')} onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </Button>
      </div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {t('settings.connectionResults').replace('{0}', String(filtered.length))}
      </div>
      {filtered.length === 0 && (
        <p className="text-sm text-muted">{t('settings.noConnectionsFound')}</p>
      )}
      {groups.map((group) => (
        <div key={group} className="space-y-2">
          <h3 className="text-caption font-semibold text-muted">{t(group)}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {filtered
              .filter((choice) => choice.group === group)
              .map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  aria-label={choice.name}
                  onClick={() => onPick(choice.id)}
                  className="flex items-start gap-3 rounded-surface border border-border px-3 py-3 text-left transition-colors hover:border-accent hover:bg-surface-2 focus-ring"
                >
                  <span aria-hidden="true" className="mt-0.5 shrink-0">
                    {choice.icon}
                  </span>
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text">
                      {choice.name}
                      {choice.experimental && (
                        <Badge variant="warning">{t('search.experimental')}</Badge>
                      )}
                    </span>
                    <span className="block text-caption text-muted">{t(choice.description)}</span>
                  </span>
                </button>
              ))}
          </div>
        </div>
      ))}
      {onExperimentalChange && (
        <label className="flex items-start gap-3 border-t border-border-subtle pt-4">
          <input
            type="checkbox"
            checked={experimental}
            disabled={saving}
            onChange={(event) => onExperimentalChange(event.target.checked)}
            className="mt-1"
          />
          <span className="text-sm text-text">
            {t('settings.showExperimentalIntegrations')}
            <span className="mt-1 block text-caption text-muted">
              {t('settings.experimentalIntegrationsHelp')}
            </span>
          </span>
        </label>
      )}
    </section>
  )
}
