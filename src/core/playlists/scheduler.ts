import { CronScheduler } from '@/core/ops/cron-scheduler'

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
    scheduler.schedule(`playlist-${playlist.id}`, playlist.schedule, () =>
      options.generate(playlist.id),
    )
  }
}
