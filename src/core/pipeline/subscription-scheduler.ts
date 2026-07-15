import { CronScheduler } from '@/core/ops/cron-scheduler'

export class SubscriptionScheduler extends CronScheduler {
  constructor() {
    super('[scheduler]')
  }
}
