import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { prefersReducedMotion } from '../../lib/utils'
import { ADMIN_TABS, type Tab } from './tabs'

export function TabBar({
  active,
  onChange,
  isAdmin,
}: {
  active: Tab
  onChange: (t: Tab) => void
  isAdmin: boolean
}) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const allTabs: { id: Tab; label: string }[] = [
    { id: 'connections', label: t('settings.tabs.connections') },
    { id: 'targets', label: t('settings.tabs.targets') },
    { id: 'recommendations', label: t('settings.tabs.recommendations') },
    { id: 'blocked', label: t('settings.tabs.blocked') },
    { id: 'schedule', label: t('settings.tabs.schedule') },
    { id: 'account', label: t('settings.tabs.account') },
    { id: 'auth', label: t('settings.tabs.authentication') },
    { id: 'users', label: t('settings.tabs.users') },
    { id: 'administration', label: t('settings.tabs.administration') },
    { id: 'jobs', label: t('settings.tabs.jobHistory') },
    { id: 'system-health', label: t('settings.tabs.systemHealth') },
  ]
  const tabs = allTabs.filter((tab) => !ADMIN_TABS.has(tab.id) || isAdmin)
  const visibleTabLabels = tabs.map((tab) => tab.label).join('\u0000')
  const activeTabLabel = tabs.find((tab) => tab.id === active)?.label

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const maxScrollLeft = Math.max(element.scrollWidth - element.clientWidth, 0)
    setCanScrollLeft(element.scrollLeft > 1)
    setCanScrollRight(maxScrollLeft - element.scrollLeft > 1)
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    window.addEventListener('resize', updateScrollState)
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollState)
    resizeObserver?.observe(element)

    return () => {
      window.removeEventListener('resize', updateScrollState)
      resizeObserver?.disconnect()
    }
  }, [updateScrollState])

  useEffect(() => {
    if (visibleTabLabels) updateScrollState()
  }, [visibleTabLabels, updateScrollState])

  useEffect(() => {
    if (!activeTabLabel) return
    const activeTab = scrollRef.current?.querySelector<HTMLElement>(
      `[data-settings-tab="${active}"]`,
    )
    activeTab?.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [active, activeTabLabel])

  function scrollTabs(direction: -1 | 1) {
    const element = scrollRef.current
    if (!element) return
    element.scrollBy({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      left: direction * element.clientWidth * 0.75,
    })
  }

  return (
    <div className="relative -mx-6 mb-6">
      {canScrollLeft && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-bg via-bg/90 to-transparent"
          />
          <button
            type="button"
            aria-label={t('settings.tabs.scrollLeft')}
            onClick={() => scrollTabs(-1)}
            className="absolute left-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg/95 text-text shadow-sm hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>
        </>
      )}
      <div
        ref={scrollRef}
        data-testid="settings-tabs-scroll"
        onScroll={updateScrollState}
        className="flex gap-1 overflow-x-auto scroll-px-16 border-b border-border px-6"
        style={{ scrollbarWidth: 'none' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            data-settings-tab={tab.id}
            type="button"
            aria-current={active === tab.id ? 'page' : undefined}
            onClick={() => onChange(tab.id)}
            className={[
              'px-3 sm:px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0',
              active === tab.id
                ? 'border-accent text-text'
                : 'border-transparent text-muted hover:text-text',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {canScrollRight && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-bg via-bg/90 to-transparent"
          />
          <button
            type="button"
            aria-label={t('settings.tabs.scrollRight')}
            onClick={() => scrollTabs(1)}
            className="absolute right-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg/95 text-text shadow-sm hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  )
}
