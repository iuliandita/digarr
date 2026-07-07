import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { type BlockedAlbumApi, deleteAlbumBlock, listAlbumBlocks } from '../lib/api'
import { useI18n } from '../lib/i18n'

export function BlockedAlbumsTab() {
  const { locale, t } = useI18n()
  const [items, setItems] = useState<BlockedAlbumApi[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    listAlbumBlocks()
      .then((r) => {
        if (active) setItems(r.items)
      })
      .catch(() => {
        toast.error(t('settings.blockedAlbums.error'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [t])

  const unblock = async (row: BlockedAlbumApi) => {
    setItems((prev) => prev.filter((x) => x.id !== row.id))
    try {
      await deleteAlbumBlock(row.releaseGroupMbid)
      toast.success(t('settings.blockedAlbums.unblock_success'))
    } catch {
      toast.error(t('settings.blockedAlbums.unblock_failed'))
      setItems((prev) => [...prev, row])
    }
  }

  const countLabel =
    items.length === 1
      ? t('settings.blockedAlbums.count_one').replace('{0}', String(items.length))
      : t('settings.blockedAlbums.count_other').replace('{0}', String(items.length))

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text">{t('settings.blockedAlbums.title')}</h2>
      <div className="text-sm text-muted">{countLabel}</div>

      {items.length === 0 && !loading && (
        <div className="text-sm text-muted py-8 text-center">
          <div>{t('settings.blockedAlbums.empty')}</div>
          <div className="text-xs mt-1">{t('settings.blockedAlbums.empty_hint')}</div>
        </div>
      )}

      <ul className="grid gap-1.5">
        {items.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between bg-surface border border-border rounded-md px-3 py-2"
          >
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-text truncate">{row.artistName}</span>
                {row.reason && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-bg border border-border text-muted">
                    {t(`rejectionReason.${row.reason}`)}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted truncate">{row.releaseGroupMbid}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span>{new Date(row.blockedAt).toLocaleDateString(locale)}</span>
              <button
                type="button"
                onClick={() => unblock(row)}
                className="text-accent hover:underline"
              >
                {t('settings.blockedAlbums.unblock')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
