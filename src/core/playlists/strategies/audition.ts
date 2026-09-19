import type { PlaylistStrategyImpl } from './types'

export const auditionStrategy: PlaylistStrategyImpl = {
  async selectArtists(deps, config) {
    return deps.getPendingArtists({ limit: config.size })
  },
}
