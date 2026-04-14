export function TargetIcon({ type }: { type: string }) {
  switch (type) {
    case 'lidarr':
      return <img src="/icons/lidarr.png" alt="" className="w-4 h-4" />
    case 'navidrome':
      return <img src="/icons/navidrome.svg" alt="" className="w-4 h-4" />
    case 'jellyfin':
      return <img src="/icons/jellyfin.svg" alt="" className="w-4 h-4" />
    default:
      return <div className="w-4 h-4" />
  }
}

export function canApproveArtistToTarget(type: string): boolean {
  return type === 'lidarr' || type === 'slskd'
}

export function resolveApprovalTargetOptions(
  targets: Array<{
    id: number
    type: string
    config?: Record<string, unknown>
    enabled?: boolean
    owned?: boolean
  }>,
  targetId: string,
): { approvalMode: 'single_target' | 'combined_lidarr_slskd'; lidarrTargetId?: string } {
  const target = targets.find((item) => `${item.type}-${item.id}` === targetId)
  const lidarrTargets = targets.filter(
    (item) =>
      item.type === 'lidarr' &&
      (item.enabled === undefined || item.enabled) &&
      (item.owned === undefined || item.owned),
  )

  if (target?.type === 'slskd') {
    const linkedTargetIdRaw = target.config?.lidarrTargetId
    if (linkedTargetIdRaw != null) {
      const linkedTargetId = `lidarr-${Number(linkedTargetIdRaw)}`
      if (lidarrTargets.some((item) => `${item.type}-${item.id}` === linkedTargetId)) {
        return { approvalMode: 'combined_lidarr_slskd', lidarrTargetId: linkedTargetId }
      }
    }

    if (lidarrTargets.length === 1) {
      const lidarrTarget = lidarrTargets[0]
      return lidarrTarget
        ? {
            approvalMode: 'combined_lidarr_slskd',
            lidarrTargetId: `${lidarrTarget.type}-${lidarrTarget.id}`,
          }
        : { approvalMode: 'single_target' }
    }
  }

  return { approvalMode: 'single_target' }
}

import type { MessageKey } from '@/core/i18n/messages/types'

export function targetActionLabel(
  type: string,
  name: string,
  t: (key: MessageKey) => string,
): string {
  switch (type) {
    case 'lidarr':
    case 'slskd':
      return t('target.action.addTo').replace('{0}', name)
    case 'navidrome':
    case 'jellyfin':
      return t('target.action.favoriteIn').replace('{0}', name)
    case 'spotify-playlist':
      return t('target.action.addToSpotifyPlaylist')
    default:
      return t('target.action.sendTo').replace('{0}', name)
  }
}
