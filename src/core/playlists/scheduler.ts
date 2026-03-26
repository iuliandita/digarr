import { Cron } from 'croner'

type ScheduledJob = { name: string; cron: Cron; expression: string }

export class PlaylistScheduler {
  private jobs = new Map<string, ScheduledJob>()

  schedule(name: string, cronExpression: string, fn: () => Promise<void>): void {
    this.remove(name)
    const cron = new Cron(cronExpression, async () => {
      try {
        await fn()
      } catch (err: unknown) {
        console.error(`[playlist-scheduler] Job '${name}' (${cronExpression}) failed:`, err)
      }
    })
    this.jobs.set(name, { name, cron, expression: cronExpression })
  }

  remove(name: string): void {
    const job = this.jobs.get(name)
    if (job) {
      job.cron.stop()
      this.jobs.delete(name)
    }
  }

  has(name: string): boolean {
    return this.jobs.has(name)
  }

  listJobs(): Array<{ name: string; expression: string; nextRun: Date | null }> {
    return [...this.jobs.values()].map((job) => ({
      name: job.name,
      expression: job.expression,
      nextRun: job.cron.nextRun() ?? null,
    }))
  }

  nextRun(name?: string): Date | null {
    if (name) return this.jobs.get(name)?.cron.nextRun() ?? null

    return (
      this.listJobs()
        .map((job) => job.nextRun)
        .filter((run): run is Date => run instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
    )
  }

  stop(): void {
    this.stopAll()
  }

  stopAll(): void {
    for (const job of this.jobs.values()) {
      job.cron.stop()
    }
    this.jobs.clear()
  }
}
