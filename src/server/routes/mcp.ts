import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type Context, Hono } from 'hono'
import * as z from 'zod'
import { envConfig } from '@/config/env'
import { REJECTION_REASONS } from '@/core/recommendations/rejection-reasons'
import { isValidStatus } from '@/core/recommendations/statuses'
import { getPlaylistsByUser } from '@/db/queries/playlists'
import type { ListedRecommendation, RecommendationWithArtist } from '@/db/queries/recommendations'
import type { AppDependencies } from '@/server'
import { decodeCursor, encodeCursor } from '@/server/helpers/pagination-cursor'
import { rateLimiter } from '@/server/middleware/rate-limit'
import { updateRecommendationSchema } from '@/server/schemas/recommendations'
import type { HonoEnv } from '@/server/types'
import { VERSION } from '@/version'
import { pipelineRoutes } from './pipeline'
import { recommendationRoutes } from './recommendations'

const MAX_BODY_BYTES = 1024 * 1024
const settingsSchema = z
  .record(z.string().min(1).max(64), z.unknown())
  .refine((value) => Object.keys(value).length <= 64, 'At most 64 settings are allowed')
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 16 * 1024,
    'Settings must not exceed 16 KiB',
  )
type OperationsEnv = HonoEnv & { Bindings: { requestContext: Context<HonoEnv> } }

const idSchema = z.number().int().positive()
const rejectionInput = {
  id: idSchema,
  reason: z.enum(REJECTION_REASONS).optional(),
  reasonText: z.string().max(200).optional(),
}

class ToolFailure extends Error {}

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

function result(value: Record<string, unknown>, isError = false): CallToolResult {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
  }
}

function projectRecommendation(
  rec: ListedRecommendation | RecommendationWithArtist,
): Record<string, unknown> {
  return {
    id: rec.id,
    status: rec.status,
    kind: rec.kind,
    score: rec.score,
    sources: rec.sources,
    reasoning: rec.aiReasoning,
    recommendedReleaseGroupId: rec.recommendedReleaseGroupId,
    recommendedReleaseGroupTitle: rec.recommendedReleaseGroupTitle,
    recommendedRecordingMbid: rec.recommendedRecordingMbid,
    recommendedRecordingTitle: rec.recommendedRecordingTitle,
    rejectionReason: rec.rejectionReason,
    rejectionReasonText: rec.rejectionReasonText,
    createdAt: rec.createdAt,
    actedOnAt: rec.actedOnAt,
    artist: {
      id: rec.artist.id,
      mbid: rec.artist.mbid,
      name: rec.artist.name,
      genres: rec.artist.genres,
      beginYear: rec.artist.beginYear,
      endYear: rec.artist.endYear,
    },
  }
}

function createServer(deps: AppDependencies, c: Context<HonoEnv>, operations: Hono<OperationsEnv>) {
  const userId = c.get('userId')
  if (!userId || c.get('authMethod') !== 'api-token') throw new ToolFailure('Not authenticated')
  const server = new McpServer({ name: 'digarr', version: VERSION })

  async function dispatch(path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown) {
    const headers = new Headers()
    for (const name of ['Accept-Language', 'X-Digarr-Locale']) {
      const value = c.req.header(name)
      if (value) headers.set(name, value)
    }
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const response = await operations.fetch(
      new Request(new URL(path, c.req.url), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { requestContext: c },
    )
    if (!response.ok) {
      const details = (await response.json().catch(() => null)) as { code?: string } | null
      const message =
        response.status === 404
          ? 'Not found'
          : response.status === 429
            ? 'Too many requests'
            : response.status === 409
              ? details?.code === 'errors.approval.requestLimit'
                ? 'The maximum number of open approval requests has been reached'
                : details?.code === 'errors.approval.declineCooldown'
                  ? 'This approval request was recently declined. Try again after 24 hours.'
                  : path.startsWith('/api/v1/pipeline/')
                    ? 'A scan is already running'
                    : 'The operation conflicts with the current state'
              : response.status === 400
                ? 'The operation could not be completed with these inputs'
                : 'The operation failed'
      throw new ToolFailure(message)
    }
    return (await response.json()) as Record<string, unknown>
  }

  function tool<Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: Shape,
    readOnly: boolean,
    run: (input: z.infer<z.ZodObject<Shape>>) => Promise<Record<string, unknown>>,
    isFailure?: (output: Record<string, unknown>) => boolean,
  ) {
    const schema = z.object(inputSchema).strict()
    server.registerTool<z.ZodRawShape, typeof schema>(
      name,
      {
        description,
        inputSchema: schema,
        annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true },
      },
      async (input) => {
        if (!readOnly && c.get('apiTokenScope') === 'read') {
          return failure('A write or admin token is required')
        }
        try {
          const output = await run(input as z.infer<z.ZodObject<Shape>>)
          return result(output, isFailure?.(output))
        } catch (error) {
          return failure(error instanceof ToolFailure ? error.message : 'The operation failed')
        }
      },
    )
  }

  tool(
    'list_recommendations',
    'List your recommendations, optionally filtered by status, decade, or kind.',
    {
      status: z.string().max(200).optional(),
      decades: z.string().max(100).optional(),
      kind: z.enum(['artist', 'album']).optional(),
      limit: z.number().int().min(1).max(200).default(20),
      offset: z.number().int().min(0).default(0),
    },
    true,
    async (input) => {
      if (
        input.status !== undefined &&
        !input.status.split(',').every((status) => isValidStatus(status.trim()))
      ) {
        throw new ToolFailure(
          'Use a valid recommendation status or comma-separated list of statuses',
        )
      }
      const page = await deps.listRecommendations({ ...input, userId })
      return { items: page.items.map(projectRecommendation), total: page.total }
    },
  )
  tool(
    'get_recommendation',
    'Get one of your recommendations.',
    { id: idSchema },
    true,
    async ({ id }) => {
      const rec = await deps.getRecommendation(id)
      if (!rec || rec.userId !== userId) throw new ToolFailure('Not found')
      return projectRecommendation(rec)
    },
  )
  tool(
    'approve_recommendation',
    'Approve one of your recommendations using your configured targets and approval options.',
    {
      id: idSchema,
      ...updateRecommendationSchema.omit({
        status: true,
        reason: true,
        reasonText: true,
        permanent: true,
      }).shape,
    },
    false,
    async ({ id, ...options }) => {
      const output = await dispatch(`/api/v1/recommendations/${id}`, 'PATCH', {
        ...options,
        status: 'approved',
      })
      if (output.status === 'requested')
        return {
          id,
          status: 'requested',
          requestId: output.requestId,
          message:
            'Approval requested. An administrator must review this request before it is added.',
        }
      const actions = output.targetActions as Record<string, { status?: unknown }> | undefined
      return {
        id,
        status: output.status,
        targets: Object.entries(actions ?? {}).map(([targetId, action]) => ({
          id: targetId,
          status: typeof action?.status === 'string' ? action.status : 'unknown',
        })),
      }
    },
    (output) =>
      output.status === 'add_failed' ||
      (Array.isArray(output.targets) &&
        output.targets.some((target) => target.status === 'failed')),
  )
  for (const permanent of [false, true]) {
    tool(
      permanent ? 'block_recommendation' : 'reject_recommendation',
      permanent
        ? 'Reject your recommendation and permanently block its artist or album from discovery.'
        : 'Reject one of your recommendations, optionally recording a structured reason.',
      rejectionInput,
      false,
      async ({ id, ...options }) => {
        if (options.reason !== 'other' && options.reasonText?.trim()) {
          throw new ToolFailure('reasonText is only allowed when reason is other')
        }
        const output = await dispatch(`/api/v1/recommendations/${id}`, 'PATCH', {
          ...options,
          status: 'rejected',
          permanent,
        })
        return { id, status: output.status, blockCreated: output.blockCreated }
      },
    )
  }
  tool(
    'run_scan',
    'Start or queue a scan using your configured connections and preferences.',
    {},
    false,
    async () => {
      const output = await dispatch('/api/v1/pipeline/run', 'POST')
      return { status: output.status, queued: output.queued, position: output.position }
    },
  )
  tool(
    'run_discovery_mode',
    'Start a named discovery mode with its mode-specific settings and return a job ID.',
    {
      modeId: z.string().trim().min(1).max(100),
      settingsMode: z.string().max(64).optional(),
      rawUserSettings: settingsSchema.optional(),
      normalizedSettings: settingsSchema.optional(),
    },
    false,
    async (input) => {
      const output = await dispatch('/api/v1/discovery-modes/run', 'POST', input)
      return { jobId: output.jobId }
    },
  )
  tool(
    'get_scan_status',
    'Get scan and queue status permitted by your token scope.',
    {},
    true,
    async () => {
      const output = await dispatch('/api/v1/pipeline/status', 'GET')
      return {
        running: output.running,
        stage: output.stage,
        queueLength: output.queueLength,
        queuePosition: output.queuePosition,
        lastRun: output.lastRun,
      }
    },
  )
  tool(
    'get_job_status',
    'Get safe status details for one of your jobs.',
    { id: idSchema },
    true,
    async ({ id }) => {
      const job = await deps.jobQueries.getJobById(id)
      if (!job || job.userId !== userId) throw new ToolFailure('Not found')
      return {
        id: job.id,
        type: job.type,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        durationMs: job.durationMs,
        batchId: job.batchId,
      }
    },
  )
  tool(
    'search_artists',
    'Search your available artist sources.',
    {
      query: z.string().trim().min(1).max(200),
      limit: z.number().int().min(1).max(50).default(20),
      sources: z.array(z.string().min(1).max(100)).max(20).optional(),
    },
    true,
    async ({ query, limit, sources }) => {
      if (!deps.search) throw new ToolFailure('Search is unavailable')
      const matches = await deps.search.search(query, { limit, sources, userId })
      return {
        results: matches.map((artist) => ({
          name: artist.name,
          mbid: artist.mbid,
          genres: artist.genres,
          popularity: artist.popularity,
          listeners: artist.listeners,
          sources: artist.sources.map((source) => ({ id: source.id })),
          inLibrary: artist.inLibrary,
          inRecommendations: artist.inRecommendations,
        })),
      }
    },
  )
  tool(
    'list_playlists',
    'List your playlists with cursor pagination.',
    { limit: z.number().int().min(1).max(100).default(20), cursor: z.string().max(512).optional() },
    true,
    async ({ limit, cursor }) => {
      const rows = await getPlaylistsByUser(deps.db, userId, {
        limit: limit + 1,
        cursor: cursor ? decodeCursor(cursor) : null,
      })
      const hasMore = rows.length > limit
      const page = rows.slice(0, limit)
      const last = page[page.length - 1]
      return {
        items: page.map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          strategy: playlist.strategy,
          enabled: playlist.enabled,
          trackCount: playlist.trackCount,
          lastGeneratedAt: playlist.lastGeneratedAt,
          createdAt: playlist.createdAt,
        })),
        nextCursor:
          hasMore && last ? encodeCursor({ id: last.id, ts: last.createdAt.toISOString() }) : null,
      }
    },
  )
  return server
}

export function mcpRoutes(deps: AppDependencies, pipeline = pipelineRoutes(deps)) {
  const router = new Hono<HonoEnv>()
  const operations = new Hono<OperationsEnv>()
  operations.onError(() => new Response(null, { status: 500 }))
  operations.use('*', async (inner, next) => {
    const outer = inner.env.requestContext
    inner.set('userId', outer.get('userId'))
    inner.set('authMethod', outer.get('authMethod'))
    inner.set('apiTokenScope', outer.get('apiTokenScope'))
    await next()
  })
  for (const path of ['/api/v1/pipeline/run', '/api/v1/discovery-modes/run']) {
    operations.use(
      path,
      rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: path, getIp: () => null }),
    )
  }
  operations.route('/', recommendationRoutes(deps))
  operations.route('/', pipeline)
  router.use('/api/v1/mcp', rateLimiter({ windowMs: 60_000, max: 120, keyPrefix: 'mcp' }))
  const handle = async (c: Context<HonoEnv>) => {
    if (!c.get('userId') || c.get('authMethod') !== 'api-token') {
      c.header('WWW-Authenticate', 'Bearer realm="digarr"')
      return c.json(
        { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Not authenticated' } },
        401,
      )
    }
    const origin = c.req.header('Origin')
    if (origin !== undefined && origin !== new URL(envConfig.allowedOrigin ?? c.req.url).origin) {
      return c.json(
        { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Origin not allowed' } },
        403,
      )
    }
    if (c.req.method !== 'POST') {
      c.header('Allow', 'POST')
      return c.json(
        { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } },
        405,
      )
    }
    const tooLarge = () =>
      c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Request body must not exceed 1 MiB' },
        },
        413,
      )
    const contentLength = c.req.header('Content-Length')
    if (contentLength !== undefined && Number(contentLength) > MAX_BODY_BYTES) return tooLarge()
    let parsedBody: unknown
    try {
      const reader = c.req.raw.body?.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > MAX_BODY_BYTES) {
              void reader.cancel().catch(() => {})
              return tooLarge()
            }
            chunks.push(value)
          }
        } finally {
          reader.releaseLock()
        }
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      parsedBody = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      return c.json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } },
        400,
      )
    }
    if (Array.isArray(parsedBody)) {
      return c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Batch requests are not supported' },
        },
        400,
      )
    }
    const server = createServer(deps, c, operations)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    try {
      await server.connect(transport)
      return await transport.handleRequest(c.req.raw, { parsedBody })
    } catch {
      return c.json(
        { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal server error' } },
        500,
      )
    } finally {
      await server.close()
    }
  }
  router.post('/api/v1/mcp', handle)
  router.get('/api/v1/mcp', handle)
  router.delete('/api/v1/mcp', handle)
  router.all('/api/v1/mcp', handle)
  return router
}
