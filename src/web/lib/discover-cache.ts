import { hashKey, type InfiniteData, type QueryClient, type QueryKey } from '@tanstack/react-query'

export type DiscoverFilter = 'all' | 'pending' | 'approved' | 'rejected'
type Row = { id: number; status: string }
type Page = { items: unknown[]; total: number }
type Cached = Page | InfiniteData<Page>

export const RECOMMENDATION_COUNTS_KEY = ['recommendations', 'counts'] as const

const APPROVED_STATUSES = new Set(['added_to_lidarr', 'add_failed', 'approved', 'waiting'])

// 'requested' means an approval request was filed: the row stays pending but
// the server hides it from the Pending tab until the request is decided.
const shownStatus = (status: string) => (status === 'requested' ? 'pending' : status)

export function matchesFilter(filter: DiscoverFilter, status: string): boolean {
  if (filter === 'all') return true
  if (filter === 'approved') return APPROVED_STATUSES.has(status)
  return status === filter
}

/** Discover list keys: ['recommendations', { filter, page, ... }] or ['recommendations', 'stack', { filter, ... }]. */
function listFilter(key: QueryKey): DiscoverFilter | undefined {
  const meta = key[1] === 'stack' ? key[2] : key[1]
  return meta && typeof meta === 'object' && 'filter' in meta
    ? (meta as { filter: DiscoverFilter }).filter
    : undefined
}

export type RowPosition = { queryHash: string; page: number; index: number }
export type StatusChange = { row?: Row; removedAt: RowPosition[]; rollback: () => void }

/**
 * Applies a status change to every cached Discover list without refetching.
 * The row is dropped from lists whose filter it no longer matches (with the
 * total, and so the stack's next offset, reduced by one) and keeps its place
 * with the new status elsewhere. `restore` re-inserts a dropped row where it was.
 */
export function applyStatusChange(
  client: QueryClient,
  id: number,
  status: string,
  restore?: { row: Row; at: RowPosition[] },
): StatusChange {
  const snapshot: Array<[QueryKey, Cached]> = []
  const removedAt: RowPosition[] = []
  let found: Row | undefined
  for (const [queryKey, data] of client.getQueriesData<Cached>({ queryKey: ['recommendations'] })) {
    const filter = listFilter(queryKey)
    if (!filter || !data) continue
    const queryHash = hashKey(queryKey)
    const keep = matchesFilter(filter, status)
    let present = false
    let pages = ('pages' in data ? data.pages : [data]).map((page, p) => {
      const items = page.items as Row[]
      if (!items.some((r) => r.id === id)) return page
      present = true
      found ??= items.find((r) => r.id === id)
      if (keep)
        return {
          ...page,
          items: items.map((r) => (r.id === id ? { ...r, status: shownStatus(status) } : r)),
        }
      items.forEach((r, index) => {
        if (r.id === id) removedAt.push({ queryHash, page: p, index })
      })
      return { ...page, items: items.filter((r) => r.id !== id) }
    })
    let delta = present && !keep ? -1 : 0
    const at = restore && keep && !present && restore.at.find((pos) => pos.queryHash === queryHash)
    if (at && restore) {
      const p = Math.min(at.page, pages.length - 1)
      pages = pages.map((page, i) => {
        if (i !== p) return page
        const items = [...page.items]
        items.splice(Math.min(at.index, items.length), 0, {
          ...restore.row,
          status: shownStatus(status),
        })
        return { ...page, items }
      })
      delta = 1
    }
    if (!present && !at) continue
    snapshot.push([queryKey, data])
    const next = pages.map((page) => ({ ...page, total: Math.max(0, page.total + delta) }))
    client.setQueryData<Cached>(queryKey, 'pages' in data ? { ...data, pages: next } : next[0])
  }
  return {
    row: found,
    removedAt,
    rollback: () => {
      for (const [queryKey, data] of snapshot) client.setQueryData(queryKey, data)
    },
  }
}

/**
 * After an action: refetch only the tab counts and mark every other
 * recommendations query stale, so inactive views reload on their next use.
 */
export function settleAfterAction(client: QueryClient, opts: { approval?: boolean } = {}) {
  void client.invalidateQueries({ queryKey: ['recommendations'], refetchType: 'none' })
  void client.invalidateQueries({ queryKey: RECOMMENDATION_COUNTS_KEY })
  if (opts.approval) void client.invalidateQueries({ queryKey: ['approval-requests'] })
}
