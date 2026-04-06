import type { LibrarySource } from './types'

export class LibrarySourceRegistry {
  private sources = new Map<string, LibrarySource>()

  register(source: LibrarySource): void {
    this.sources.set(source.id, source)
  }

  get(id: string): LibrarySource | undefined {
    return this.sources.get(id)
  }

  /**
   * Return all sources sorted by mbidQuality (high first). Stable for ties.
   * High-quality sources sync first so their MBIDs anchor low-quality ones.
   */
  allOrdered(): LibrarySource[] {
    return Array.from(this.sources.values()).sort((a, b) => {
      if (a.mbidQuality === b.mbidQuality) return 0
      return a.mbidQuality === 'high' ? -1 : 1
    })
  }

  clear(): void {
    this.sources.clear()
  }
}
