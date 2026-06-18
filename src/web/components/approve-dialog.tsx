import { useEffect, useState } from 'react'
import { getLidarrApproveOptions } from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { MonitorOption } from './monitoring-options'
import { Button } from './ui/button'

type Profile = { id: number; name: string }
type RootFolder = { id: number; path: string }

type Props = {
  defaults: { qualityProfileId: number; metadataProfileId: number; rootFolderId: number }
  monitorOption: MonitorOption
  onConfirm: (overrides: {
    monitorOption: MonitorOption
    qualityProfileId: number
    metadataProfileId: number
    rootFolderId: number
  }) => void
  onCancel: () => void
}

export function ApproveDialog({ defaults, monitorOption, onConfirm, onCancel }: Props) {
  const { t } = useI18n()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [metadataProfiles, setMetadataProfiles] = useState<Profile[]>([])
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([])
  const [qp, setQp] = useState(String(defaults.qualityProfileId))
  const [mp, setMp] = useState(String(defaults.metadataProfileId))
  const [rf, setRf] = useState(String(defaults.rootFolderId))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    getLidarrApproveOptions()
      .then((opts) => {
        setProfiles(opts.qualityProfiles)
        setMetadataProfiles(opts.metadataProfiles)
        setRootFolders(opts.rootFolders)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <div
        className="fixed inset-0 bg-bg/70 backdrop-blur-sm z-50"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: dialog content wrapper prevents click-through */}
        <div
          className="bg-surface border border-border rounded-lg shadow-lg w-full max-w-sm p-4"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        >
          <h3 className="text-sm font-medium text-text mb-3">{t('approveDialog.title')}</h3>

          {loading ? (
            <p className="text-sm text-muted">{t('approveDialog.loadingProfiles')}</p>
          ) : error ? (
            <p className="text-sm text-red-400">{t('approveDialog.loadFailed')}</p>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-muted">{t('approveDialog.qualityProfile')}</span>
                <select
                  value={qp}
                  onChange={(e) => setQp(e.target.value)}
                  className="mt-1 w-full bg-bg border border-border rounded text-sm text-text px-2 py-1.5"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted">{t('approveDialog.metadataProfile')}</span>
                <select
                  value={mp}
                  onChange={(e) => setMp(e.target.value)}
                  className="mt-1 w-full bg-bg border border-border rounded text-sm text-text px-2 py-1.5"
                >
                  {metadataProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted">{t('approveDialog.rootFolder')}</span>
                <select
                  value={rf}
                  onChange={(e) => setRf(e.target.value)}
                  className="mt-1 w-full bg-bg border border-border rounded text-sm text-text px-2 py-1.5"
                >
                  {rootFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.path}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <Button size="sm" variant="outline" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              className="bg-approve text-bg hover:bg-approve/90"
              disabled={
                loading ||
                error ||
                profiles.length === 0 ||
                metadataProfiles.length === 0 ||
                rootFolders.length === 0
              }
              onClick={() =>
                onConfirm({
                  monitorOption,
                  qualityProfileId: parseInt(qp, 10),
                  metadataProfileId: parseInt(mp, 10),
                  rootFolderId: parseInt(rf, 10),
                })
              }
            >
              {t('target.action.addToLidarr')}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
