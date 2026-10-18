import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import {
  type DashboardCardId,
  type DashboardCardSize,
  type DashboardLayout,
  mergeDashboardLayout,
} from '@/core/dashboard-layout'
import type { MessageKey } from '@/core/i18n/messages/types'
import { useI18n } from '../lib/i18n'
import { Button } from './ui/button'
import { Select } from './ui/select'

export const DASHBOARD_TITLES: Record<DashboardCardId, MessageKey> = {
  pick: 'dashboard.todaysPick',
  decisions: 'dashboard.yourDecisions',
  listening: 'dashboard.listening',
  genres: 'genres.title',
  subscriptions: 'subscriptions.title',
}

export const DASHBOARD_LINKS: Record<DashboardCardId, string> = {
  pick: '/discover',
  decisions: '/discover?status=approved',
  listening: '/settings?tab=connections',
  genres: '/genres',
  subscriptions: '/subscriptions',
}

export function DashboardCustomize({
  layout,
  disabled,
  onChange,
}: {
  layout: DashboardLayout
  disabled: boolean
  onChange: (layout: DashboardLayout) => void
}) {
  const { t, locale } = useI18n()
  const instructionsId = useId()
  const [announcement, setAnnouncement] = useState('')
  const dragging = useRef<DashboardCardId | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  function move(id: DashboardCardId, index: number) {
    const from = layout.cards.findIndex((card) => card.id === id)
    if (disabled || from === index || index < 0 || index >= layout.cards.length) return
    const cards = [...layout.cards]
    const card = cards.splice(from, 1)[0]
    if (!card) return
    cards.splice(index, 0, card)
    onChange({ ...layout, cards })
    setAnnouncement(
      t('dashboard.cardMoved')
        .replace('{card}', t(DASHBOARD_TITLES[id]))
        .replace('{position}', new Intl.NumberFormat(locale).format(index + 1))
        .replace('{total}', new Intl.NumberFormat(locale).format(cards.length)),
    )
  }

  function targetAt(x: number, y: number) {
    return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-dashboard-editor-card]')
      ?.dataset.dashboardEditorCard
  }

  return (
    <section
      id="dashboard-customize"
      aria-label={t('dashboard.customize')}
      className="space-y-3 rounded-surface border border-border bg-surface p-4"
    >
      <p id={instructionsId} className="text-sm text-muted">
        {t('dashboard.reorderHelp')}
      </p>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          className="accent-accent"
          checked={layout.showEmpty}
          disabled={disabled}
          onChange={(event) => onChange({ ...layout, showEmpty: event.target.checked })}
        />
        {t('dashboard.showEmptyCards')}
      </label>
      <ol className="space-y-2">
        {layout.cards.map((card, index) => {
          const title = t(DASHBOARD_TITLES[card.id])
          return (
            <li
              key={card.id}
              data-dashboard-editor-card={card.id}
              className={`flex flex-wrap items-center gap-2 rounded-control border p-2 ${dropTarget === card.id ? 'border-accent bg-accent/10' : 'border-border'}`}
            >
              <Button
                variant="ghost"
                size="icon"
                aria-disabled={disabled}
                className="touch-none cursor-grab aria-disabled:opacity-50"
                aria-label={t('dashboard.reorderCard').replace('{card}', title)}
                aria-describedby={instructionsId}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault()
                    move(card.id, index + (event.key === 'ArrowUp' ? -1 : 1))
                  }
                  if (event.key === 'Escape') {
                    dragging.current = null
                    setDropTarget(null)
                  }
                }}
                onPointerDown={(event) => {
                  if (disabled || event.button !== 0) return
                  dragging.current = card.id
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                  if (dragging.current)
                    setDropTarget(targetAt(event.clientX, event.clientY) ?? null)
                }}
                onPointerUp={(event) => {
                  const id = dragging.current
                  const target = targetAt(event.clientX, event.clientY)
                  dragging.current = null
                  setDropTarget(null)
                  if (id && target)
                    move(
                      id,
                      layout.cards.findIndex((card) => card.id === target),
                    )
                }}
                onPointerCancel={() => {
                  dragging.current = null
                  setDropTarget(null)
                }}
              >
                <GripVertical size={16} aria-hidden="true" />
              </Button>
              <label className="flex min-h-11 flex-1 items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  className="accent-accent"
                  disabled={disabled}
                  checked={card.visible}
                  onChange={(event) =>
                    onChange({
                      ...layout,
                      cards: layout.cards.map((item) =>
                        item.id === card.id ? { ...item, visible: event.target.checked } : item,
                      ),
                    })
                  }
                />
                {title}
              </label>
              <Select
                className="w-auto"
                aria-label={t('dashboard.cardSize').replace('{card}', title)}
                value={card.size}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...layout,
                    cards: layout.cards.map((item) =>
                      item.id === card.id
                        ? { ...item, size: event.target.value as DashboardCardSize }
                        : item,
                    ),
                  })
                }
              >
                <option value="small">{t('dashboard.sizeSmall')}</option>
                <option value="medium">{t('dashboard.sizeMedium')}</option>
                <option value="large">{t('dashboard.sizeLarge')}</option>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                disabled={disabled || index === 0}
                aria-label={t('dashboard.moveUp').replace('{card}', title)}
                onClick={() => move(card.id, index - 1)}
              >
                <ArrowUp size={16} aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={disabled || index === layout.cards.length - 1}
                aria-label={t('dashboard.moveDown').replace('{card}', title)}
                onClick={() => move(card.id, index + 1)}
              >
                <ArrowDown size={16} aria-hidden="true" />
              </Button>
            </li>
          )
        })}
      </ol>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => {
          onChange(mergeDashboardLayout(undefined))
          setAnnouncement(t('dashboard.layoutReset'))
        }}
      >
        {t('dashboard.resetLayout')}
      </Button>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  )
}
