import { describe, expect, it } from 'vitest'
import { resolveApprovalTargetOptions } from '@/web/components/target-utils'

const lidarr = (id: number, extra: { enabled?: boolean; owned?: boolean } = {}) => ({
  id,
  type: 'lidarr',
  ...extra,
})
const slskd = (id: number, lidarrTargetId?: number) => ({
  id,
  type: 'slskd',
  config: lidarrTargetId === undefined ? {} : { lidarrTargetId },
})

describe('resolveApprovalTargetOptions', () => {
  it.each([
    ['combines with the only Lidarr target', [slskd(7), lidarr(1)], 'slskd-7', 'lidarr-1'],
    [
      'uses the linked Lidarr target among several',
      [slskd(7, 2), lidarr(1), lidarr(2)],
      'slskd-7',
      'lidarr-2',
    ],
    ['stays standalone without Lidarr', [slskd(7)], 'slskd-7', undefined],
    [
      'ignores disabled Lidarr targets',
      [slskd(7), lidarr(1, { enabled: false })],
      'slskd-7',
      undefined,
    ],
    [
      'ignores Lidarr targets the user does not own',
      [slskd(7), lidarr(1, { owned: false })],
      'slskd-7',
      undefined,
    ],
    [
      'stays standalone with several Lidarr targets and no valid link',
      [slskd(7, 9), lidarr(1), lidarr(2)],
      'slskd-7',
      undefined,
    ],
    ['never combines a non-slskd target', [lidarr(1), lidarr(2)], 'lidarr-1', undefined],
  ])('%s', (_name, targets, targetId, lidarrTargetId) => {
    const result = resolveApprovalTargetOptions(targets, targetId)

    expect(result).toEqual(
      lidarrTargetId
        ? { approvalMode: 'combined_lidarr_slskd', lidarrTargetId }
        : { approvalMode: 'single_target' },
    )
  })
})
