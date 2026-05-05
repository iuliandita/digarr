import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type BlockedArtistApi,
  createArtistBlock,
  deleteArtistBlock,
  listArtistBlocks,
} from '../lib/api'
import { useI18n } from '../lib/i18n'

export function BlockedArtistsTab() {
  const { locale, t } = useI18n()
  const [items, setItems] = useState<BlockedArtistApi[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)

  // Debounced search: each keystroke schedules a fetch 250ms later, prior
  // schedule is cancelled by `active` flag + clearTimeout cleanup. `reload` is
  // a bump counter - present in deps to force a refetch even though the body
  // doesn't read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is intentionally a refetch trigger
  useEffect(() => {
    let active = true
    setLoading(true)
    const handle = setTimeout(async () => {
      try {
        const r = await listArtistBlocks({ q: q || undefined })
        if (!active) return
        setItems(r.items)
        setCursor(r.nextCursor)
      } catch {
        toast.error(t('settings.blocked.error'))
      } finally {
        if (active) setLoading(false)
      }
    }, 250)
    return () => {
      active = false
      clearTimeout(handle)
    }
  }, [q, reload, t])

  const loadMore = async () => {
    if (!cursor) return
    const r = await listArtistBlocks({ cursor, q: q || undefined })
    setItems((prev) => [...prev, ...r.items])
    setCursor(r.nextCursor)
  }

  const unblock = async (row: BlockedArtistApi) => {
    setItems((prev) => prev.filter((x) => x.artistId !== row.artistId))
    try {
      await deleteArtistBlock(row.artistId)
      toast.success(t('settings.blocked.unblock_success'), {
        action: {
          label: t('settings.blocked.unblock_undo'),
          onClick: async () => {
            try {
              await createArtistBlock({
                artistId: row.artistId,
                reason: row.reason,
                reasonText: row.reasonText,
              })
              setReload((n) => n + 1)
            } catch {
              toast.error(t('settings.blocked.error'))
            }
          },
        },
      })
    } catch {
      toast.error(t('settings.blocked.unblock_failed'))
      setReload((n) => n + 1)
    }
  }

  const countLabel =
    items.length === 1
      ? t('settings.blocked.count_one').replace('{0}', String(items.length))
      : t('settings.blocked.count_other').replace('{0}', String(items.length))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">{t('settings.blocked.title')}</h2>
        <input
          type="search"
          placeholder={t('settings.blocked.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="bg-bg border border-border rounded-md px-2 py-1 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
        />
      </div>
      <div className="text-sm text-muted">{countLabel}</div>

      {items.length === 0 && !loading && (
        <div className="text-sm text-muted py-8 text-center">
          <div>{t('settings.blocked.empty')}</div>
          <div className="text-xs mt-1">{t('settings.blocked.empty_hint')}</div>
        </div>
      )}

      <ul className="grid gap-1.5">
        {items.map((row) => (
          <li
            key={row.artistId}
            className="flex items-center justify-between bg-surface border border-border rounded-md px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium text-text truncate">{row.name}</span>
              {row.reason && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-bg border border-border text-muted">
                  {t(`rejectionReason.${row.reason}`)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span>{new Date(row.blockedAt).toLocaleDateString(locale)}</span>
              <button
                type="button"
                onClick={() => unblock(row)}
                className="text-accent hover:underline"
              >
                {t('settings.blocked.unblock')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {cursor && (
        <button type="button" onClick={loadMore} className="text-sm text-accent hover:underline">
          {t('settings.blocked.loadMore')}
        </button>
      )}
    </div>
  )
}
