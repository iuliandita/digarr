import PQueue from 'p-queue'

type WarmStatus = 'warm' | 'warming' | 'unknown'

type SkyHookWarmerDeps = {
  lookupArtist: (term: string) => Promise<unknown[]>
}

export class SkyHookWarmer {
  private deps: SkyHookWarmerDeps
  private status = new Map<string, WarmStatus>()
  private queue = new PQueue({ concurrency: 1, interval: 1000, intervalCap: 1 })

  constructor(deps: SkyHookWarmerDeps) {
    this.deps = deps
  }

  getStatus(mbid: string): WarmStatus {
    return this.status.get(mbid) ?? 'unknown'
  }

  isWarm(mbid: string): boolean {
    return this.status.get(mbid) === 'warm'
  }

  private evictIfNeeded(): void {
    if (this.status.size <= 5000) return
    // Evict 'warm' entries - cheapest to re-warm if needed
    for (const [mbid, s] of this.status) {
      if (s === 'warm') this.status.delete(mbid)
    }
  }

  async warm(mbid: string): Promise<void> {
    if (this.status.get(mbid) === 'warm') return
    if (this.status.get(mbid) === 'warming') return

    this.status.set(mbid, 'warming')
    try {
      await this.queue.add(async () => {
        await this.deps.lookupArtist(`lidarr:${mbid}`)
      })
      this.evictIfNeeded()
      this.status.set(mbid, 'warm')
    } catch {
      this.status.set(mbid, 'unknown')
    }
  }

  async warmBatch(mbids: string[]): Promise<void> {
    const unique = [...new Set(mbids)]
    const unwarmed = unique.filter((mbid) => this.status.get(mbid) !== 'warm')
    await Promise.all(unwarmed.map((mbid) => this.warm(mbid)))
  }

  warmInBackground(mbid: string): void {
    this.warm(mbid).catch(() => {})
  }
}
