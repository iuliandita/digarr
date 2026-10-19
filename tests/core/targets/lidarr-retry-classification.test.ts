import { describe, expect, it } from 'vitest'
import { isTemporaryLidarrFailure, targetAction } from '@/core/targets/lidarr-retry'

describe('Lidarr temporary failure classification', () => {
  it.each([408, 429])('defers HTTP %s responses', (status) => {
    const error = `HTTP ${status}: request could not complete`
    expect(isTemporaryLidarrFailure(error)).toBe(true)
    expect(
      targetAction(
        { type: 'lidarr' },
        { success: false, targetType: 'lidarr', targetId: 1, error },
        {},
      ).status,
    ).toBe('waiting')
  })

  it.each([
    ['album not found in Lidarr', false],
    ['album not found in Lidarr after adding artist (metadata may still be refreshing)', true],
    [
      'Compilation releases aren\'t allowed by the Lidarr metadata profile "StudioAlbumOnly" - allow that in Lidarr or pick a different metadata profile for this artist',
      false,
    ],
  ])('uses same-attempt artist creation context for %s', (error, temporary) => {
    expect(isTemporaryLidarrFailure(error)).toBe(temporary)
  })
})
