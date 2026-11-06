export const MAX_LIBRARY_PAGES = 1000
export const MAX_LIBRARY_ITEMS = 200_000

export type LibraryPage<T> = { items: T[]; total: unknown }

export type LibraryPagingLabel = {
  /** Server name used in errors, e.g. 'Plex'. */
  server: string
  kind: 'artist' | 'album'
  /** Name of the server's total-count field, e.g. 'totalSize'. */
  totalField: string
}

function reportedTotal(label: LibraryPagingLabel, total: unknown): number {
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
    throw new Error(`${label.server} returned an invalid ${label.totalField}`)
  }
  if (total > MAX_LIBRARY_ITEMS) {
    throw new Error(
      `${label.server} ${label.totalField} exceeds the ${MAX_LIBRARY_ITEMS} item limit`,
    )
  }
  return total
}

/**
 * Pages a media-server library listing with a server-independent ceiling, so a
 * user-supplied server cannot keep the shared process fetching and buffering forever.
 */
export async function collectLibraryPages<T>(
  label: LibraryPagingLabel,
  pageSize: number,
  fetchPage: (start: number) => Promise<LibraryPage<T>>,
): Promise<T[]> {
  const all: T[] = []
  let start = 0
  let total = Number.POSITIVE_INFINITY
  let reported: number | undefined
  let pageCount = 0

  while (start < total) {
    if (pageCount >= MAX_LIBRARY_PAGES) {
      throw new Error(
        `${label.server} ${label.kind} pagination exceeded ${MAX_LIBRARY_PAGES} pages`,
      )
    }
    pageCount += 1
    const { items, total: rawTotal } = await fetchPage(start)
    // Later pages may omit the count; without any count, only a short page ends paging.
    if (rawTotal !== undefined) reported = reportedTotal(label, rawTotal)
    total = reported ?? start + items.length + (items.length >= pageSize ? 1 : 0)
    if (all.length + items.length > MAX_LIBRARY_ITEMS) {
      throw new Error(
        `${label.server} ${label.kind} listing exceeds the ${MAX_LIBRARY_ITEMS} item limit`,
      )
    }
    all.push(...items)
    if (items.length === 0) break
    start += items.length
  }

  return all
}
