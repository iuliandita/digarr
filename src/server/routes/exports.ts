import { Hono } from 'hono'
import { exportToCsv } from '@/core/targets/export-csv'
import { exportToJson } from '@/core/targets/export-json'
import { exportToM3u } from '@/core/targets/export-m3u'
import { exportToXspf } from '@/core/targets/export-xspf'
import type { ExportableRecommendation } from '@/core/targets/types'
import type {
  ListRecommendationsFilters,
  ListRecommendationsResult,
} from '@/db/queries/recommendations'
import type { HonoEnv } from '@/server/types'

type ExportDeps = {
  listRecommendations: (filters?: ListRecommendationsFilters) => Promise<ListRecommendationsResult>
}

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  csv: 'text/csv',
  m3u: 'audio/x-mpegurl',
  xspf: 'application/xspf+xml',
}

const EXPORTERS: Record<string, (recs: ExportableRecommendation[]) => string> = {
  json: exportToJson,
  csv: exportToCsv,
  m3u: exportToM3u,
  xspf: exportToXspf,
}

function parseOptionalInteger(value: string | undefined, field: string): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid ${field}: ${value}`)
  }
  return parsed
}

export function exportRoutes(deps: ExportDeps) {
  const router = new Hono<HonoEnv>()

  router.get('/api/v1/exports/:format', async (c) => {
    const format = c.req.param('format')
    if (!CONTENT_TYPES[format] || !EXPORTERS[format]) {
      return c.json({ error: `Unsupported format: ${format}. Use json, csv, m3u, or xspf` }, 400)
    }

    const userId = c.get('userId')
    const query = c.req.query()
    let batchId: number | undefined
    try {
      batchId = parseOptionalInteger(query.batchId, 'batchId')
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
    const filters: ListRecommendationsFilters = {
      userId,
      limit: 10000, // Export all matching
      status: query.status,
      batchId,
    }

    const result = await deps.listRecommendations(filters)

    const exportable: ExportableRecommendation[] = result.items.map((rec) => ({
      artistName: rec.artist?.name ?? 'Unknown',
      artistMbid: rec.artist?.mbid ?? '',
      genres: rec.artist?.genres ?? [],
      score: rec.score ?? 0,
      status: rec.status ?? 'pending',
      aiReasoning: rec.aiReasoning ?? undefined,
      imageUrl: rec.artist?.imageUrl ?? undefined,
      streamingUrls: rec.artist?.streamingUrls ?? {},
      createdAt:
        typeof rec.createdAt === 'string' ? rec.createdAt : new Date(rec.createdAt).toISOString(),
      suggestedAlbum: rec.recommendedReleaseGroupTitle ?? undefined,
    }))

    // format already validated above - safe to index directly
    const output = EXPORTERS[format]?.(exportable)
    const timestamp = new Date().toISOString().slice(0, 10)

    return new Response(output, {
      headers: {
        'Content-Type': CONTENT_TYPES[format] ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename="digarr-export-${timestamp}.${format}"`,
      },
    })
  })

  return router
}
