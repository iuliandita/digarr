import { CronScheduler } from '@/core/ops/cron-scheduler'
import { errMsg } from '@/core/validation'

export class PlaylistScheduler extends CronScheduler {
  constructor() {
    super('[playlist-scheduler]')
  }
}

/** Replaces every playlist job; nothing is scheduled while the global switch is off. */
export function schedulePlaylists(
  scheduler: PlaylistScheduler,
  options: {
    enabled: boolean
    playlists: Array<{ id: number; schedule: string | null }>
    generate: (playlistId: number) => Promise<void>
  },
): void {
  scheduler.stopAll()
  if (!options.enabled) return
  for (const playlist of options.playlists) {
    if (!playlist.schedule) continue
    // One invalid stored cron must not stop the remaining playlists from scheduling.
    try {
      scheduler.schedule(`playlist-${playlist.id}`, playlist.schedule, () =>
        options.generate(playlist.id),
      )
    } catch (err: unknown) {
      console.error(`[playlist-scheduler] playlist ${playlist.id} not scheduled:`, errMsg(err))
    }
  }
}
