import { CronScheduler } from '@/core/ops/cron-scheduler'

export class PlaylistScheduler extends CronScheduler {
  constructor() {
    super('[playlist-scheduler]')
  }
}
