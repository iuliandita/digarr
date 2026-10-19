// Compact catalog for routes without a hand-written operation in openapi-doc.ts.
// Request bodies reuse the route validators through z.toJSONSchema; response
// bodies stay loose where docs/API.md is the detailed contract.

import { z } from 'zod'
import { backupFileSchema } from '@/server/schemas/admin'
import { approvalRequestDecisionSchema } from '@/server/schemas/approval-requests'
import {
  changePasswordSchema,
  createApiTokenSchema,
  oidcLinkSchema,
  updateEmailSchema,
  updateLocaleSchema,
  updatePreferencesSchema,
} from '@/server/schemas/auth'
import {
  libraryAlbumOverrideSchema,
  libraryOverrideSchema,
  librarySyncSchema,
  libraryWarmSchema,
} from '@/server/schemas/library'
import {
  approveOptionsQuerySchema,
  lidarrAddSchema,
  lidarrTagSchema,
} from '@/server/schemas/lidarr'
import { migrateRequestSchema, migrateTargetSchema } from '@/server/schemas/migrate'
import { moodDiscoverSchema } from '@/server/schemas/mood'
import { oauthInitiateSchema } from '@/server/schemas/oauth'
import { discoveryModeRunSchema, quickDiscoverSchema } from '@/server/schemas/pipeline'
import {
  createPlaylistSchema,
  resetPlaylistExportSchema,
  updatePlaylistSchema,
} from '@/server/schemas/playlists'
import { bulkRecommendationSchema, missingAlbumsSchema } from '@/server/schemas/recommendations'
import { notificationChannel, updateSettingsSchema } from '@/server/schemas/settings'
import { setupCompleteSchema } from '@/server/schemas/setup'
import {
  bulkToggleSchema,
  createSubscriptionSchema,
  deezerPlaylistImportSchema,
  spotifyPlaylistImportSchema,
  updateSubscriptionSchema,
} from '@/server/schemas/subscriptions'
import { createTargetSchema, updateTargetSchema } from '@/server/schemas/targets'
import { userNotificationChannelsSchema } from '@/server/schemas/user-notifications'
import { createUserSchema, updateUserSchema } from '@/server/schemas/users'

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete'
type Auth = 'public' | 'user' | 'admin' | 'adminOrOwner' | 'cookie' | 'apiToken' | 'conditional'
type JsonSchema = Record<string, unknown>

interface Ok {
  status: string
  description: string
  schema?: JsonSchema
  contentType?: string
}

interface RouteSpec {
  method: Method
  path: string
  tag: string
  auth: Auth
  summary: string
  description?: string
  body?: JsonSchema
  validatedBody?: boolean
  multipart?: string
  query?: Array<{ name: string; schema: JsonSchema; description?: string; required?: boolean }>
  params?: Record<string, JsonSchema>
  ok?: Ok
  errors?: Record<string, string>
  rateLimit?: string
  cursorPage?: boolean
  queryToken?: boolean
}

const json = 'application/json'
const problemJson = 'application/problem+json'
const anyObject = { type: 'object', additionalProperties: true }
const anyArray = { type: 'array', items: anyObject }
const intId = { type: 'integer', minimum: 1 }
const UNSAFE = new Set<Method>(['post', 'patch', 'put', 'delete'])

function zodBody(schema: z.ZodType): JsonSchema {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema
  return rest
}

function zodQuery(schema: z.ZodType): NonNullable<RouteSpec['query']> {
  const body = zodBody(schema) as { properties?: Record<string, JsonSchema>; required?: string[] }
  return Object.entries(body.properties ?? {}).map(([name, propSchema]) => ({
    name,
    schema: propSchema,
    required: body.required?.includes(name) ?? false,
  }))
}

function q(name: string, schema: JsonSchema, description?: string) {
  return { name, schema, ...(description ? { description } : {}) }
}

const str = { type: 'string' }
const limitQuery = (max?: number) =>
  q('limit', { type: 'integer', minimum: 1, ...(max ? { maximum: max } : {}) })
const exportFormat = { type: 'string', enum: ['json', 'csv', 'm3u', 'xspf'] }
const oauthProvider = { type: 'string', enum: ['spotify', 'deezer', 'tidal', 'lastfm'] }
const redirect = (description: string): Ok => ({ status: '302', description })
const accepted = (description: string, schema: JsonSchema = anyObject): Ok => ({
  status: '202',
  description,
  schema,
})
const noContent = (description: string): Ok => ({ status: '204', description })
const created = (description: string, schema: JsonSchema = anyObject): Ok => ({
  status: '201',
  description,
  schema,
})
const list = (description: string): Ok => ({ status: '200', description, schema: anyArray })
const download = (description: string): Ok => ({
  status: '200',
  description,
  contentType: 'application/octet-stream',
  schema: { type: 'string', format: 'binary' },
})
const body = (schema: z.ZodType) => ({ body: zodBody(schema), validatedBody: true })

export const routeCatalog: RouteSpec[] = [
  // API metadata
  {
    method: 'get',
    path: '/api/v1/docs',
    tag: 'API metadata',
    auth: 'public',
    summary: 'HTML entry point for the API reference',
    ok: { status: '200', description: 'HTML page.', contentType: 'text/html', schema: str },
  },
  {
    method: 'get',
    path: '/api/v1/docs/openapi.json',
    tag: 'API metadata',
    auth: 'public',
    summary: 'This OpenAPI document',
  },
  {
    method: 'get',
    path: '/health',
    tag: 'Health',
    auth: 'public',
    summary: 'Liveness check',
    description:
      'Returns { status: "ok", version, gitSha, channel, dbBackend }. While draining or when the database is unavailable it returns 503 with a plain JSON { status } body, not problem+json.',
    errors: {},
  },

  // MCP
  {
    method: 'post',
    path: '/api/v1/mcp',
    tag: 'MCP',
    auth: 'apiToken',
    summary: 'Stateless Streamable HTTP MCP endpoint',
    description:
      'Accepts one JSON-RPC message per request (batch arrays return 400) with a 1 MiB body limit. Tool and protocol errors use MCP shapes; see docs/MCP.md.',
    body: anyObject,
    errors: { '413': 'Request body exceeds 1 MiB.' },
  },
  {
    method: 'get',
    path: '/api/v1/mcp',
    tag: 'MCP',
    auth: 'apiToken',
    summary: 'No server event stream (405)',
    ok: { status: '405', description: 'Method not allowed; no persistent server event stream.' },
  },
  {
    method: 'delete',
    path: '/api/v1/mcp',
    tag: 'MCP',
    auth: 'apiToken',
    summary: 'No MCP session to terminate (405)',
    ok: { status: '405', description: 'Method not allowed; there is no MCP session.' },
  },

  // Auth
  {
    method: 'post',
    path: '/api/v1/auth/logout',
    tag: 'Auth',
    auth: 'user',
    summary: 'Invalidate the current session',
    ok: noContent('Session invalidated.'),
  },
  {
    method: 'get',
    path: '/api/v1/auth/meta',
    tag: 'Auth',
    auth: 'user',
    summary: 'Deployment metadata',
    ok: {
      status: '200',
      description: 'Version and enabled auth integrations.',
      schema: {
        type: 'object',
        properties: {
          version: str,
          oidcEnabled: { type: 'boolean' },
          proxyAuthEnabled: { type: 'boolean' },
        },
      },
    },
  },
  {
    method: 'get',
    path: '/api/v1/auth/me',
    tag: 'Auth',
    auth: 'user',
    summary: 'Current user profile',
    ok: {
      status: '200',
      description: 'Current user.',
      schema: { $ref: '#/components/schemas/User' },
    },
    errors: { '404': 'User no longer exists.' },
  },
  {
    method: 'get',
    path: '/api/v1/auth/validate',
    tag: 'Auth',
    auth: 'user',
    summary: 'Check that the session or token is valid',
    ok: noContent('Credentials are valid.'),
  },
  {
    method: 'patch',
    path: '/api/v1/auth/me/locale',
    tag: 'Auth',
    auth: 'user',
    summary: 'Update the saved user locale',
    ...body(updateLocaleSchema),
    errors: { '404': 'User not found.' },
  },
  {
    method: 'patch',
    path: '/api/v1/auth/me/email',
    tag: 'Auth',
    auth: 'user',
    summary: "Set or clear the user's email",
    ...body(updateEmailSchema),
    rateLimit: '5/min',
    errors: { '404': 'User not found.', '409': 'Email already in use.' },
  },
  {
    method: 'post',
    path: '/api/v1/auth/change-password',
    tag: 'Auth',
    auth: 'user',
    summary: 'Change password and invalidate all sessions',
    ...body(changePasswordSchema),
    rateLimit: '5/min',
    ok: noContent('Password changed.'),
    errors: { '404': 'User not found.' },
  },
  {
    method: 'get',
    path: '/api/v1/auth/tokens',
    tag: 'Auth',
    auth: 'cookie',
    summary: "List the caller's personal API token metadata",
    description: 'Never returns token values or hashes.',
    ok: list('Token metadata.'),
  },
  {
    method: 'post',
    path: '/api/v1/auth/tokens',
    tag: 'Auth',
    auth: 'cookie',
    summary: 'Create a personal API token',
    description: 'Returns the token value once. Admin scope requires a current admin.',
    ...body(createApiTokenSchema),
    ok: created('Token created; the value is shown only in this response.'),
  },
  {
    method: 'delete',
    path: '/api/v1/auth/tokens/{id}',
    tag: 'Auth',
    auth: 'cookie',
    summary: 'Revoke an owned personal API token',
    params: { id: intId },
    ok: noContent('Token revoked.'),
    errors: { '404': 'Token missing or not owned by the caller.' },
  },
  {
    method: 'get',
    path: '/api/v1/auth/me/preferences',
    tag: 'Auth',
    auth: 'user',
    summary: 'Get merged user preferences',
    errors: { '404': 'User not found.' },
  },
  {
    method: 'patch',
    path: '/api/v1/auth/me/preferences',
    tag: 'Auth',
    auth: 'user',
    summary: 'Update user preferences (top-level partial merge)',
    ...body(updatePreferencesSchema),
    ok: noContent('Preferences saved.'),
    errors: { '404': 'User not found.' },
  },
  {
    method: 'get',
    path: '/api/v1/auth/me/write-back',
    tag: 'Auth',
    auth: 'user',
    summary: 'Scrobbler configuration, connection state, and last send errors',
  },
  {
    method: 'get',
    path: '/api/v1/auth/oidc/login',
    tag: 'Auth',
    auth: 'public',
    summary: 'Redirect to the OIDC provider',
    description:
      'Requires ALLOWED_ORIGIN. Sets a browser-bound, one-time, 10-minute HttpOnly transaction cookie.',
    rateLimit: '10/min',
    ok: redirect('Redirect to the identity provider.'),
    errors: { '400': 'OIDC is not configured.', '503': 'Identity provider unavailable.' },
  },
  {
    method: 'post',
    path: '/api/v1/auth/oidc/link',
    tag: 'Auth',
    auth: 'cookie',
    summary: 'Start linking an OIDC identity to the current local account',
    description: 'Requires the current local password and an unlinked local account.',
    ...body(oidcLinkSchema),
    rateLimit: '5/min',
    ok: {
      status: '200',
      description: 'Authorization URL to open.',
      schema: { type: 'object', required: ['url'], properties: { url: str } },
    },
    errors: {
      '404': 'User not found.',
      '409': 'Account already linked.',
      '503': 'Identity provider unavailable.',
    },
  },
  {
    method: 'get',
    path: '/api/v1/auth/oidc/callback',
    tag: 'Auth',
    auth: 'public',
    summary: 'OIDC callback',
    description:
      'Consumes the browser-bound transaction cookie once. Login sets a session cookie; linking also requires the initiating session.',
    query: [q('code', str), q('state', str)],
    ok: redirect('Redirect back into the app.'),
  },
  {
    method: 'post',
    path: '/api/v1/auth/oauth/{provider}/initiate',
    tag: 'Auth',
    auth: 'user',
    summary: 'Start a provider OAuth flow',
    description:
      'Sets a browser-bound, 10-minute HttpOnly transaction cookie scoped to the provider callback path.',
    params: { provider: oauthProvider },
    ...body(oauthInitiateSchema),
    ok: {
      status: '200',
      description: 'Authorization URL to open.',
      schema: { type: 'object', properties: { url: str } },
    },
    errors: { '502': 'Provider authorization request failed.' },
  },
  {
    method: 'get',
    path: '/api/v1/auth/oauth/{provider}/callback',
    tag: 'Auth',
    auth: 'public',
    summary: 'Spotify, Deezer, and TIDAL OAuth callback',
    description:
      'Requires the transaction cookie from initiate; the pending authorization is consumed on read. Errors redirect with oauth_error.',
    params: { provider: { type: 'string', enum: ['spotify', 'deezer', 'tidal'] } },
    query: [q('code', str), q('state', str), q('error', str)],
    ok: redirect('Redirect back into the app.'),
  },
  {
    method: 'get',
    path: '/api/v1/auth/oauth/lastfm/callback/{state}',
    tag: 'Auth',
    auth: 'public',
    summary: 'Last.fm OAuth callback',
    description: 'Reads the one-time state from the path and the request token from ?token=.',
    query: [q('token', str)],
    ok: redirect('Redirect back into the app.'),
  },
  {
    method: 'get',
    path: '/api/v1/auth/oauth/{provider}/status',
    tag: 'Auth',
    auth: 'user',
    summary: 'Provider connection status',
    params: { provider: oauthProvider },
  },
  {
    method: 'delete',
    path: '/api/v1/auth/oauth/{provider}',
    tag: 'Auth',
    auth: 'user',
    summary: 'Disconnect a provider',
    params: { provider: oauthProvider },
    ok: noContent('Provider disconnected.'),
  },

  // Setup
  {
    method: 'get',
    path: '/api/v1/setup/status',
    tag: 'Setup',
    auth: 'public',
    summary: 'Check whether setup is complete',
  },
  {
    method: 'post',
    path: '/api/v1/setup/complete',
    tag: 'Setup',
    auth: 'conditional',
    summary: 'Complete initial setup',
    description: 'The options that need an owner are Lidarr and Emby services.',
    ...body(setupCompleteSchema),
    ok: noContent('Setup completed.'),
    errors: { '409': 'Setup already complete or required state is missing.' },
  },

  // Pipeline
  {
    method: 'post',
    path: '/api/v1/pipeline/run',
    tag: 'Pipeline',
    auth: 'user',
    summary: 'Start or queue a full discovery scan',
    ok: accepted('Scan started, queued, or deduplicated.', {
      type: 'object',
      properties: {
        message: str,
        status: { type: 'string', enum: ['started', 'queued', 'duplicate'] },
        queued: { type: 'boolean' },
        position: { type: ['integer', 'null'] },
      },
    }),
  },
  {
    method: 'post',
    path: '/api/v1/pipeline/cancel',
    tag: 'Pipeline',
    auth: 'user',
    summary: "Cancel the caller's in-flight run and drop its queued run",
    description: 'Admins can cancel any run.',
    ok: accepted('Cancellation requested.', {
      type: 'object',
      properties: { cancelled: { type: 'boolean' }, message: str },
    }),
  },
  {
    method: 'get',
    path: '/api/v1/pipeline/status',
    tag: 'Pipeline',
    auth: 'user',
    summary: 'Current pipeline status',
    description:
      'Admins see the global run, queue, and last batch; other users see only their own runs.',
  },
  {
    method: 'get',
    path: '/api/v1/pipeline/events',
    tag: 'Pipeline',
    auth: 'user',
    summary: "SSE stream of the caller's pipeline progress",
    queryToken: true,
    ok: {
      status: '200',
      description: 'Server-sent events.',
      contentType: 'text/event-stream',
      schema: str,
    },
  },
  {
    method: 'post',
    path: '/api/v1/pipeline/quick-discover',
    tag: 'Pipeline',
    auth: 'user',
    summary: 'Discover artists similar to a seed in the background',
    ...body(quickDiscoverSchema),
    rateLimit: '5/min',
    errors: { '409': 'A quick discover run is already in progress.' },
  },
  {
    method: 'post',
    path: '/api/v1/pipeline/rescan',
    tag: 'Pipeline',
    auth: 'admin',
    summary: 'Re-fetch images and metadata for up to 200 recommendations',
    errors: { '409': 'A rescan is already running.' },
  },

  // Discovery modes
  {
    method: 'get',
    path: '/api/v1/discovery-modes',
    tag: 'Discovery modes',
    auth: 'user',
    summary: 'List discovery modes with availability and field metadata',
    ok: list('Discovery modes.'),
  },
  {
    method: 'post',
    path: '/api/v1/discovery-modes/run',
    tag: 'Discovery modes',
    auth: 'user',
    summary: 'Start a manual discovery-mode run',
    ...body(discoveryModeRunSchema),
    ok: accepted('Run started.', { type: 'object', properties: { jobId: { type: 'integer' } } }),
    errors: { '409': 'A run is already in progress.' },
  },

  // Recommendations
  {
    method: 'post',
    path: '/api/v1/recommendations/bulk',
    tag: 'Recommendations',
    auth: 'user',
    summary: 'Bulk approve or reject recommendations',
    ...body(bulkRecommendationSchema),
    ok: {
      status: '200',
      description: 'Number of updated recommendations.',
      schema: { type: 'object', properties: { updated: { type: 'integer' } } },
    },
    errors: { '409': 'Open-request limit reached.' },
  },
  {
    method: 'post',
    path: '/api/v1/recommendations/missing-albums',
    tag: 'Recommendations',
    auth: 'user',
    summary: 'Approve selected missing studio albums for an artist',
    ...body(missingAlbumsSchema),
    ok: accepted('Album approvals submitted.'),
    errors: {
      '404': 'Artist not found.',
      '409': 'Selection no longer matches current coverage.',
      '503': 'Coverage lookup unavailable.',
    },
  },
  {
    method: 'get',
    path: '/api/v1/recommendations/feedback-summary',
    tag: 'Recommendations',
    auth: 'user',
    summary: "Genre approval rates from the caller's feedback",
  },
  {
    method: 'get',
    path: '/api/v1/recommendations/counts',
    tag: 'Recommendations',
    auth: 'user',
    summary: "Discover tab counts for the caller's recommendations",
  },
  {
    method: 'get',
    path: '/api/v1/recommendations/popular-albums/availability',
    tag: 'Recommendations',
    auth: 'user',
    summary: 'Credential availability for the popular-album approve option',
  },
  {
    method: 'get',
    path: '/api/v1/recommendations/playability',
    tag: 'Recommendations',
    auth: 'user',
    summary: "Playable-track summary for the caller's pending artists from recent Audition runs",
  },

  // Personal notification channels
  {
    method: 'get',
    path: '/api/v1/auth/me/notification-channels',
    tag: 'Personal notification channels',
    auth: 'user',
    summary: "Read the caller's channels with secrets masked",
    errors: { '404': 'User not found.' },
  },
  {
    method: 'patch',
    path: '/api/v1/auth/me/notification-channels',
    tag: 'Personal notification channels',
    auth: 'user',
    summary: "Replace the caller's request-outcome channels",
    ...body(userNotificationChannelsSchema),
    ok: noContent('Channels saved.'),
    errors: { '404': 'User not found.' },
  },

  // Approval requests
  {
    method: 'get',
    path: '/api/v1/approval-requests',
    tag: 'Approval requests',
    auth: 'admin',
    summary: 'Review approval requests',
  },
  {
    method: 'get',
    path: '/api/v1/approval-requests/mine',
    tag: 'Approval requests',
    auth: 'user',
    summary: "List the caller's approval requests",
  },
  {
    method: 'post',
    path: '/api/v1/approval-requests/{id}/approve',
    tag: 'Approval requests',
    auth: 'admin',
    summary: 'Approve a request with the saved approval choices',
    params: { id: intId },
    ...body(approvalRequestDecisionSchema),
    errors: { '404': 'Request not found.', '409': 'Request already decided.' },
  },
  {
    method: 'post',
    path: '/api/v1/approval-requests/{id}/decline',
    tag: 'Approval requests',
    auth: 'admin',
    summary: 'Decline a pending request',
    params: { id: intId },
    ...body(approvalRequestDecisionSchema),
    errors: { '404': 'Request not found.', '409': 'Request already decided.' },
  },

  // Album blocks
  {
    method: 'get',
    path: '/api/v1/album-blocks',
    tag: 'Album blocks',
    auth: 'user',
    summary: 'List up to 500 albums blocked by the caller',
  },
  {
    method: 'delete',
    path: '/api/v1/album-blocks/{releaseGroupMbid}',
    tag: 'Album blocks',
    auth: 'user',
    summary: 'Remove an album from the blocklist',
    params: { releaseGroupMbid: { type: 'string', format: 'uuid' } },
    ok: noContent('Album block removed or already absent.'),
  },

  // Artists and media
  {
    method: 'get',
    path: '/api/v1/artists/{id}',
    tag: 'Artists',
    auth: 'user',
    summary: 'Get an artist',
    params: { id: intId },
  },
  {
    method: 'get',
    path: '/api/v1/artists/{id}/top-tracks',
    tag: 'Artists',
    auth: 'user',
    summary: 'Top 5 tracks (Deezer, MusicBrainz fallback)',
    params: { id: intId },
  },
  {
    method: 'get',
    path: '/api/v1/artists/{id}/enrichment',
    tag: 'Artists',
    auth: 'user',
    summary: 'Cached Wikidata description and external links',
    params: { id: intId },
    query: [q('locale', str)],
  },
  {
    method: 'get',
    path: '/api/v1/albums/{mbid}',
    tag: 'Artists',
    auth: 'user',
    summary: 'Release groups for an artist MBID',
    params: { mbid: { type: 'string', format: 'uuid' } },
  },
  {
    method: 'get',
    path: '/api/v1/preview/audio',
    tag: 'Artists',
    auth: 'user',
    summary: 'Proxy Deezer preview audio',
    queryToken: true,
    rateLimit: '30/min',
    query: [{ ...q('url', str), required: true }],
    ok: {
      status: '200',
      description: 'Audio stream.',
      contentType: 'audio/mpeg',
      schema: { type: 'string', format: 'binary' },
    },
    errors: { '502': 'Upstream preview fetch failed.' },
  },
  {
    method: 'get',
    path: '/api/v1/media/image-proxy',
    tag: 'Media',
    auth: 'user',
    summary: 'Proxy whitelisted AudioDB images',
    query: [{ ...q('src', str), required: true }],
    ok: {
      status: '200',
      description: 'Image bytes.',
      contentType: 'image/*',
      schema: { type: 'string', format: 'binary' },
    },
    errors: { '404': 'Image proxying disabled.', '502': 'Upstream image fetch failed.' },
  },

  // Batches
  {
    method: 'get',
    path: '/api/v1/batches',
    tag: 'Batches',
    auth: 'admin',
    summary: 'List recommendation batches',
    cursorPage: true,
  },
  {
    method: 'get',
    path: '/api/v1/batches/{id}',
    tag: 'Batches',
    auth: 'admin',
    summary: 'Get batch details',
    params: { id: intId },
  },

  // Subscriptions
  {
    method: 'get',
    path: '/api/v1/subscriptions',
    tag: 'Subscriptions',
    auth: 'user',
    summary: "List the caller's subscriptions",
    cursorPage: true,
  },
  {
    method: 'post',
    path: '/api/v1/subscriptions',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Create a subscription',
    ...body(createSubscriptionSchema),
    ok: created('Subscription created.'),
  },
  {
    method: 'patch',
    path: '/api/v1/subscriptions/{id}',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Update a subscription',
    params: { id: intId },
    ...body(updateSubscriptionSchema),
    ok: noContent('Subscription updated.'),
  },
  {
    method: 'delete',
    path: '/api/v1/subscriptions/{id}',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Delete a subscription',
    params: { id: intId },
    ok: noContent('Subscription deleted.'),
  },
  {
    method: 'post',
    path: '/api/v1/subscriptions/{id}/run',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Run a subscription now',
    params: { id: intId },
    ok: accepted('Run finished; inspect run history for the outcome.'),
    errors: { '503': 'Scheduler unavailable.' },
  },
  {
    method: 'get',
    path: '/api/v1/subscriptions/{id}/runs',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Subscription run history',
    params: { id: intId },
    ok: list('Run history.'),
  },
  {
    method: 'post',
    path: '/api/v1/subscriptions/import/spotify-liked-songs',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Import Spotify Liked Songs',
    ok: accepted('Import started.'),
  },
  {
    method: 'post',
    path: '/api/v1/subscriptions/import/spotify-playlist',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Import a Spotify playlist (URL, URI, or ID)',
    ...body(spotifyPlaylistImportSchema),
    ok: accepted('Import started; inspect run history for the outcome.'),
  },
  {
    method: 'post',
    path: '/api/v1/subscriptions/import/csv',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Import a CSV, M3U/M3U8, or XSPF file',
    description: 'Format is chosen by file extension. Max 1 MB and 500 artists.',
    multipart: 'file',
    ok: accepted('Import started.'),
    errors: { '413': 'File larger than 1 MB.' },
  },
  {
    method: 'post',
    path: '/api/v1/subscriptions/import/deezer-favorites',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Import Deezer favorites',
    ok: accepted('Import started.'),
  },
  {
    method: 'post',
    path: '/api/v1/subscriptions/import/deezer-followed',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Import Deezer followed artists',
    ok: accepted('Import started.'),
  },
  {
    method: 'get',
    path: '/api/v1/subscriptions/import/deezer-playlists',
    tag: 'Subscriptions',
    auth: 'user',
    summary: "List the caller's Deezer playlists",
  },
  {
    method: 'post',
    path: '/api/v1/subscriptions/import/deezer-playlists',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Import a Deezer playlist',
    ...body(deezerPlaylistImportSchema),
    ok: accepted('Import started.'),
  },
  {
    method: 'get',
    path: '/api/v1/subscriptions/adapter-types',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Available adapter types with config schemas',
  },
  {
    method: 'get',
    path: '/api/v1/subscriptions/scheduler',
    tag: 'Subscriptions',
    auth: 'user',
    summary: "Scheduler status for the caller's subscriptions",
  },
  {
    method: 'post',
    path: '/api/v1/subscriptions/bulk-toggle',
    tag: 'Subscriptions',
    auth: 'user',
    summary: 'Enable or disable all subscriptions',
    ...body(bulkToggleSchema),
    ok: {
      status: '200',
      description: 'Number of updated subscriptions.',
      schema: { type: 'object', properties: { updated: { type: 'integer' } } },
    },
  },

  // Targets
  {
    method: 'get',
    path: '/api/v1/targets',
    tag: 'Targets',
    auth: 'user',
    summary: 'List targets with masked secrets',
    description: 'Admins see all targets; other users see only their own.',
    cursorPage: true,
  },
  {
    method: 'post',
    path: '/api/v1/targets',
    tag: 'Targets',
    auth: 'admin',
    summary: 'Create a target',
    ...body(createTargetSchema),
    ok: created('Target created.'),
  },
  {
    method: 'patch',
    path: '/api/v1/targets/{id}',
    tag: 'Targets',
    auth: 'admin',
    summary: 'Update a target',
    params: { id: intId },
    ...body(updateTargetSchema),
    ok: noContent('Target updated.'),
  },
  {
    method: 'delete',
    path: '/api/v1/targets/{id}',
    tag: 'Targets',
    auth: 'admin',
    summary: 'Delete a target',
    params: { id: intId },
    ok: noContent('Target deleted.'),
  },
  {
    method: 'post',
    path: '/api/v1/targets/{id}/test',
    tag: 'Targets',
    auth: 'adminOrOwner',
    summary: 'Test a target connection',
    params: { id: intId },
  },

  // slskd
  {
    method: 'get',
    path: '/api/v1/slskd/jobs',
    tag: 'slskd',
    auth: 'admin',
    summary: 'Active slskd orchestration jobs and sync state',
    query: [limitQuery()],
  },
  {
    method: 'post',
    path: '/api/v1/slskd/sync',
    tag: 'slskd',
    auth: 'admin',
    summary: 'Trigger a manual slskd orchestration sync',
    ok: accepted('Sync started.'),
  },

  // Genres
  {
    method: 'get',
    path: '/api/v1/genres',
    tag: 'Genres',
    auth: 'user',
    summary: 'List genres with artist counts and examples',
  },
  {
    method: 'get',
    path: '/api/v1/genres/search',
    tag: 'Genres',
    auth: 'user',
    summary: 'Search genres',
    query: [{ ...q('q', str), required: true }],
  },
  {
    method: 'get',
    path: '/api/v1/genres/{slug}',
    tag: 'Genres',
    auth: 'user',
    summary: 'Genre detail with sub-genres and library artists',
  },
  {
    method: 'get',
    path: '/api/v1/genres/{slug}/artists',
    tag: 'Genres',
    auth: 'user',
    summary: 'Artists by genre',
    query: [
      q('view', { type: 'string', enum: ['recommended', 'trending', 'deep_cuts'] }),
      limitQuery(),
    ],
  },
  {
    method: 'post',
    path: '/api/v1/genres/seed',
    tag: 'Genres',
    auth: 'admin',
    summary: 'Seed the genre database from the Lidarr library',
    ok: accepted('Seeding started.'),
  },

  // Playlists
  {
    method: 'get',
    path: '/api/v1/playlists',
    tag: 'Playlists',
    auth: 'user',
    summary: "List the caller's playlists",
    cursorPage: true,
  },
  {
    method: 'post',
    path: '/api/v1/playlists',
    tag: 'Playlists',
    auth: 'user',
    summary: 'Create a playlist',
    ...body(createPlaylistSchema),
    ok: created('Playlist created.'),
  },
  {
    method: 'get',
    path: '/api/v1/playlists/{id}',
    tag: 'Playlists',
    auth: 'user',
    summary: 'Playlist with tracks',
    params: { id: intId },
  },
  {
    method: 'patch',
    path: '/api/v1/playlists/{id}',
    tag: 'Playlists',
    auth: 'user',
    summary: 'Update a playlist',
    params: { id: intId },
    ...body(updatePlaylistSchema),
    ok: noContent('Playlist updated.'),
  },
  {
    method: 'delete',
    path: '/api/v1/playlists/{id}',
    tag: 'Playlists',
    auth: 'user',
    summary: 'Delete a playlist',
    params: { id: intId },
    ok: noContent('Playlist deleted.'),
  },
  {
    method: 'post',
    path: '/api/v1/playlists/{id}/generate',
    tag: 'Playlists',
    auth: 'user',
    summary: 'Generate playlist tracks',
    params: { id: intId },
    ok: accepted('Generation started.'),
  },
  {
    method: 'get',
    path: '/api/v1/playlists/{id}/export/{format}',
    tag: 'Playlists',
    auth: 'user',
    summary: 'Export a playlist file',
    params: { id: intId, format: exportFormat },
    ok: download('Playlist file in the requested format.'),
  },
  {
    method: 'get',
    path: '/api/v1/playlists/{id}/exports',
    tag: 'Playlists',
    auth: 'user',
    summary: 'Owned remote export bindings',
    params: { id: intId },
  },
  {
    method: 'post',
    path: '/api/v1/playlists/{id}/exports/{targetId}/reset',
    tag: 'Playlists',
    auth: 'user',
    summary: 'Forget one local export binding',
    params: { id: intId, targetId: intId },
    ...body(resetPlaylistExportSchema),
    ok: noContent('Binding forgotten.'),
    errors: { '409': 'An export is running for this playlist.' },
  },
  {
    method: 'get',
    path: '/api/v1/playlists/scheduler',
    tag: 'Playlists',
    auth: 'user',
    summary: 'Playlist scheduler status',
  },

  // Mood and search
  {
    method: 'post',
    path: '/api/v1/mood/discover',
    tag: 'Mood discovery',
    auth: 'user',
    summary: 'AI mood-based discovery',
    ...body(moodDiscoverSchema),
    rateLimit: '10/min',
    errors: { '502': 'AI provider request failed.' },
  },
  {
    method: 'get',
    path: '/api/v1/search',
    tag: 'Search',
    auth: 'user',
    summary: 'Cross-platform artist search',
    query: [
      { ...q('q', str), required: true },
      limitQuery(),
      q('sources', str, 'Comma-separated source IDs from /api/v1/search/sources.'),
    ],
    errors: { '500': 'Search failed.' },
  },
  {
    method: 'get',
    path: '/api/v1/search/sources',
    tag: 'Search',
    auth: 'user',
    summary: 'Available search sources',
  },

  // Analytics
  ...(
    [
      ['overview', 'Summary stats'],
      ['genres', 'Top genres by recommendation count'],
      ['sources', 'Source effectiveness'],
      ['scores', 'Score distribution'],
      ['trend', 'Approval trend over time'],
      ['time-to-act', 'Time-to-decision metrics'],
    ] as const
  ).map(
    ([name, summary]): RouteSpec => ({
      method: 'get',
      path: `/api/v1/analytics/${name}`,
      tag: 'Analytics',
      auth: 'admin',
      summary,
    }),
  ),
  {
    method: 'get',
    path: '/api/v1/analytics/batches',
    tag: 'Analytics',
    auth: 'admin',
    summary: 'Batch history',
    cursorPage: true,
  },

  // Library
  {
    method: 'get',
    path: '/api/v1/library/health',
    tag: 'Library',
    auth: 'admin',
    summary: 'Library health check results',
  },
  {
    method: 'post',
    path: '/api/v1/library/health/scan',
    tag: 'Library',
    auth: 'admin',
    summary: 'Start a background health scan',
    ok: accepted('Scan started.'),
  },
  {
    method: 'post',
    path: '/api/v1/library/health/{checkId}/fix',
    tag: 'Library',
    auth: 'admin',
    summary: 'Apply the fix for a health check',
  },
  {
    method: 'get',
    path: '/api/v1/library/stats',
    tag: 'Library',
    auth: 'admin',
    summary: 'Library statistics',
  },
  {
    method: 'post',
    path: '/api/v1/library/warm',
    tag: 'Library',
    auth: 'admin',
    summary: 'Warm the SkyHook cache for MBIDs',
    ...body(libraryWarmSchema),
    ok: accepted('Warm started.'),
  },
  {
    method: 'get',
    path: '/api/v1/library/warm/status',
    tag: 'Library',
    auth: 'admin',
    summary: 'SkyHook warm status',
    query: [q('mbids', str, 'Comma-separated MBIDs.')],
  },
  {
    method: 'get',
    path: '/api/v1/library/sources',
    tag: 'Library',
    auth: 'user',
    summary: 'Per-source library sync state',
  },
  {
    method: 'post',
    path: '/api/v1/library/sync',
    tag: 'Library',
    auth: 'admin',
    summary: 'Run a manual library sync',
    ...body(librarySyncSchema),
    ok: accepted('Sync started in the background; poll GET /api/v1/library/sources for progress.', {
      type: 'object',
      properties: {
        source: { type: 'string' },
        status: { type: 'string', enum: ['started'] },
      },
    }),
    errors: {
      '404': 'Requested source is not configured.',
      '409': 'A sync is already running.',
    },
  },
  {
    method: 'get',
    path: '/api/v1/library/album-coverage/{artistMbid}',
    tag: 'Library',
    auth: 'user',
    summary: "Owned and missing studio albums for an artist in the caller's library",
    description: 'Legacy-token authentication is rejected.',
    params: { artistMbid: { type: 'string', format: 'uuid' } },
  },
  {
    method: 'post',
    path: '/api/v1/library/overrides',
    tag: 'Library',
    auth: 'admin',
    summary: 'Save a manual artist MBID override or ignore decision',
    ...body(libraryOverrideSchema),
    ok: noContent('Override saved.'),
  },
  {
    method: 'post',
    path: '/api/v1/library/album-overrides',
    tag: 'Library',
    auth: 'admin',
    summary: 'Save a manual album release-group override or ignore decision',
    ...body(libraryAlbumOverrideSchema),
    ok: noContent('Override saved.'),
  },
  {
    method: 'delete',
    path: '/api/v1/library/overrides/{source}/{sourceArtistId}',
    tag: 'Library',
    auth: 'admin',
    summary: 'Remove a saved artist override',
    ok: noContent('Override removed.'),
  },
  {
    method: 'post',
    path: '/api/v1/library/reconcile',
    tag: 'Library',
    auth: 'admin',
    summary: 'Trigger a background reconcile pass',
    ok: accepted('Reconcile started.'),
  },

  // Exports, dashboard, listening
  {
    method: 'get',
    path: '/api/v1/exports/{format}',
    tag: 'Exports',
    auth: 'user',
    summary: 'Export recommendations',
    params: { format: exportFormat },
    query: [q('status', str), q('batchId', intId)],
    ok: download('Recommendations in the requested format.'),
  },
  {
    method: 'get',
    path: '/api/v1/dashboard/taste',
    tag: 'Dashboard',
    auth: 'user',
    summary: "Top genres from the caller's library",
  },
  {
    method: 'get',
    path: '/api/v1/dashboard/genre-coverage',
    tag: 'Dashboard',
    auth: 'user',
    summary: 'Latest listening-artist genre coverage',
    ok: {
      status: '200',
      description: 'Coverage, or null before a run has recorded it.',
      schema: {
        oneOf: [
          {
            type: 'object',
            properties: {
              coveredArtists: { type: 'integer' },
              pendingArtists: { type: 'integer' },
              totalArtists: { type: 'integer' },
            },
          },
          { type: 'null' },
        ],
      },
    },
  },
  {
    method: 'get',
    path: '/api/v1/dashboard/activity',
    tag: 'Dashboard',
    auth: 'user',
    summary: 'Recent activity feed',
    query: [limitQuery()],
  },
  {
    method: 'get',
    path: '/api/v1/listening/top-artists',
    tag: 'Listening',
    auth: 'user',
    summary: 'Top artists by play count for a period',
    query: [q('range', str), limitQuery(), q('offset', { type: 'integer', minimum: 0 })],
  },
  {
    method: 'get',
    path: '/api/v1/listening/recent-tracks',
    tag: 'Listening',
    auth: 'user',
    summary: 'Most recent scrobbles',
    query: [limitQuery()],
  },

  // Settings
  {
    method: 'get',
    path: '/api/v1/settings',
    tag: 'Settings',
    auth: 'user',
    summary: 'Get settings',
    description: 'Secrets are masked; global fields are stripped for non-admins.',
    errors: { '404': 'Settings row not found.' },
  },
  {
    method: 'patch',
    path: '/api/v1/settings',
    tag: 'Settings',
    auth: 'user',
    summary: 'Update settings',
    description: 'Global fields need an admin; any user can update their own connections.',
    ...body(updateSettingsSchema),
    errors: { '404': 'Settings row not found.' },
  },
  {
    method: 'post',
    path: '/api/v1/settings/test-webhook',
    tag: 'Settings',
    auth: 'admin',
    summary: 'Send a synthetic notification to one channel',
    description:
      'Send an inline channel config (masked secrets restore from the stored channel), or select a stored channel with ?id= or body.id.',
    query: [q('id', str)],
    body: { oneOf: [zodBody(notificationChannel), { type: 'object', properties: { id: str } }] },
    ok: noContent('Notification sent.'),
    errors: { '502': 'Channel delivery failed.' },
  },

  // Users
  {
    method: 'get',
    path: '/api/v1/users',
    tag: 'Users',
    auth: 'admin',
    summary: 'List users',
    cursorPage: true,
  },
  {
    method: 'post',
    path: '/api/v1/users',
    tag: 'Users',
    auth: 'admin',
    summary: 'Create a user',
    ...body(createUserSchema),
    ok: created('User created.'),
    errors: { '409': 'Username already exists.' },
  },
  {
    method: 'patch',
    path: '/api/v1/users/{id}',
    tag: 'Users',
    auth: 'admin',
    summary: 'Update admin status, approval policy, threshold, and request limit',
    params: { id: intId },
    ...body(updateUserSchema),
    ok: noContent('User updated.'),
  },
  {
    method: 'delete',
    path: '/api/v1/users/{id}',
    tag: 'Users',
    auth: 'admin',
    summary: 'Delete a user',
    params: { id: intId },
    ok: noContent('User deleted.'),
  },

  // Lidarr
  ...(
    [
      ['stats', 'Artist and monitored counts'],
      ['profiles', 'Quality profiles'],
      ['metadataprofiles', 'Metadata profiles'],
      ['rootfolders', 'Root folders'],
    ] as const
  ).map(
    ([name, summary]): RouteSpec => ({
      method: 'get',
      path: `/api/v1/lidarr/${name}`,
      tag: 'Lidarr',
      auth: 'admin',
      summary,
    }),
  ),
  {
    method: 'get',
    path: '/api/v1/lidarr/approve-options',
    tag: 'Lidarr',
    auth: 'user',
    summary: 'Approve-dialog picker data (no free space or folder structure)',
    query: zodQuery(approveOptionsQuerySchema),
  },
  {
    method: 'post',
    path: '/api/v1/lidarr/tags',
    tag: 'Lidarr',
    auth: 'user',
    summary: 'Create a Lidarr tag',
    query: zodQuery(approveOptionsQuerySchema),
    ...body(lidarrTagSchema),
    ok: created('Tag created.', {
      type: 'object',
      properties: { id: { type: 'integer' }, label: str },
    }),
  },
  {
    method: 'post',
    path: '/api/v1/lidarr/add',
    tag: 'Lidarr',
    auth: 'admin',
    summary: 'Add an artist to the server Lidarr connection',
    ...body(lidarrAddSchema),
  },

  // Admin
  {
    method: 'post',
    path: '/api/v1/admin/backup',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Download a backup',
    query: [q('includeCaches', { type: 'boolean' })],
    ok: {
      status: '200',
      description: 'Backup JSON attachment.',
      schema: zodBody(backupFileSchema),
    },
  },
  {
    method: 'post',
    path: '/api/v1/admin/restore',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Replace data from a backup',
    description:
      'Requires ?confirm=true. Add force=true only to proceed despite an encryption-key mismatch. Accepts a multipart file or a JSON backup body.',
    query: [
      { ...q('confirm', { type: 'boolean' }), required: true },
      q('force', { type: 'boolean' }),
    ],
    multipart: 'file',
    errors: {
      '409': 'Encryption-key mismatch without force.',
      '422': 'Backup could not be applied.',
      '500': 'Restore failed and was rolled back.',
    },
  },
  {
    method: 'get',
    path: '/api/v1/admin/backup/last',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Last auto-backup metadata',
  },
  {
    method: 'get',
    path: '/api/v1/admin/migrations/pending',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Pending migration status',
  },
  {
    method: 'post',
    path: '/api/v1/admin/migrate-backend/test',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Validate migration target reachability',
    body: zodBody(migrateTargetSchema),
    errors: { '502': 'Target unreachable.' },
  },
  {
    method: 'post',
    path: '/api/v1/admin/migrate-backend',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Copy data to another database backend',
    body: zodBody(migrateRequestSchema),
    errors: {
      '409': 'Target is not empty and overwrite was not requested.',
      '422': 'Migration failed verification.',
      '500': 'Migration failed.',
    },
  },
  {
    method: 'post',
    path: '/api/v1/admin/hygiene/clear-image-failures',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Reset the image failure cache',
    query: [q('olderThan', str, 'Duration such as 7d.')],
  },
  {
    method: 'post',
    path: '/api/v1/admin/hygiene/rebuild-genres',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Rebuild the genre table from artist data',
  },
  {
    method: 'post',
    path: '/api/v1/admin/hygiene/rescore',
    tag: 'Admin',
    auth: 'admin',
    summary: "Re-score the caller's recommendations with current weights",
    query: [q('status', str)],
  },
  {
    method: 'post',
    path: '/api/v1/admin/hygiene/dedupe',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Remove duplicate recommendations',
  },
  {
    method: 'post',
    path: '/api/v1/admin/hygiene/ai-audit',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Audit AI reasoning',
    description: 'Returns 202 when autoFix=true starts a background fix.',
    query: [q('autoFix', { type: 'boolean' })],
  },
  {
    method: 'get',
    path: '/api/v1/admin/hygiene/ai-audit/results',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Poll AI audit auto-fix progress',
  },
  {
    method: 'post',
    path: '/api/v1/admin/hygiene/purge-sessions',
    tag: 'Admin',
    auth: 'admin',
    summary: 'Delete expired login sessions',
  },
]

const sessionCookie = { sessionCookie: [] }
const bearerToken = { bearerToken: [] }
const cookieWithCsrf = { sessionCookie: [], csrfHeader: [] }

function security(auth: Auth, unsafe: boolean) {
  const cookie = unsafe ? cookieWithCsrf : sessionCookie
  switch (auth) {
    case 'public':
      return []
    case 'cookie':
      return [cookie]
    case 'apiToken':
      return [bearerToken]
    case 'conditional':
      return [{}, cookie, bearerToken]
    default:
      return [cookie, bearerToken]
  }
}

const AUTH_NOTES: Partial<Record<Auth, string>> = {
  admin: 'Admin only.',
  adminOrOwner: 'Admin or the owning user.',
  cookie: 'Cookie session only; bearer and personal API tokens are rejected.',
  apiToken:
    'Personal API token only; cookie, session bearer, proxy, and legacy token auth are rejected.',
  conditional: 'Public before setup; some options require an authenticated owner.',
}

function problemRef(description: string) {
  return {
    description,
    content: { [problemJson]: { schema: { $ref: '#/components/schemas/Problem' } } },
  }
}

function pathParams(spec: RouteSpec) {
  return [...spec.path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: spec.params?.[name ?? ''] ?? { type: 'string' },
  }))
}

function buildOperation(spec: RouteSpec) {
  const unsafe = UNSAFE.has(spec.method)
  const params = pathParams(spec)
  const parameters: Array<Record<string, unknown>> = [
    ...params,
    ...(spec.query ?? []).map((param) => ({ in: 'query', required: false, ...param })),
  ]
  if (spec.cursorPage) {
    parameters.push(
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1 },
        description: 'Opt into cursor pagination. Omit limit and cursor for the legacy array.',
      },
      { name: 'cursor', in: 'query', required: false, schema: str },
    )
  }
  if (spec.queryToken) {
    parameters.push({
      name: 'token',
      in: 'query',
      required: false,
      schema: str,
      description: 'Session or personal API token for clients that cannot send headers.',
    })
  }

  const ok: Ok = spec.ok ?? {
    status: '200',
    description: 'Success.',
    schema: spec.cursorPage
      ? { oneOf: [anyArray, { $ref: '#/components/schemas/CursorPage' }] }
      : anyObject,
  }
  const responses: Record<string, unknown> = {
    [ok.status]: {
      description: ok.description,
      ...(ok.schema ? { content: { [ok.contentType ?? json]: { schema: ok.schema } } } : {}),
    },
  }
  if (spec.body || spec.multipart || parameters.length > 0) {
    responses['400'] = spec.validatedBody
      ? { $ref: '#/components/responses/ValidationFailed' }
      : { $ref: '#/components/responses/BadRequest' }
  }
  if (spec.auth !== 'public') responses['401'] = { $ref: '#/components/responses/Unauthenticated' }
  if (
    spec.auth !== 'public' &&
    (unsafe || ['admin', 'adminOrOwner', 'cookie', 'apiToken'].includes(spec.auth))
  ) {
    responses['403'] = { $ref: '#/components/responses/Forbidden' }
  }
  if (params.length > 0) responses['404'] = { $ref: '#/components/responses/NotFound' }
  if (spec.rateLimit) responses['429'] = { $ref: '#/components/responses/RateLimited' }
  for (const [status, description] of Object.entries(spec.errors ?? {})) {
    responses[status] = problemRef(description)
  }

  const description = [
    AUTH_NOTES[spec.auth],
    spec.rateLimit && `Rate limited: ${spec.rateLimit}.`,
    spec.description,
  ]
    .filter(Boolean)
    .join(' ')

  let requestBody: Record<string, unknown> | undefined
  if (spec.multipart) {
    requestBody = {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: [spec.multipart],
            properties: { [spec.multipart]: { type: 'string', format: 'binary' } },
          },
        },
        ...(spec.body ? { [json]: { schema: spec.body } } : {}),
      },
    }
  } else if (spec.body) {
    requestBody = { required: true, content: { [json]: { schema: spec.body } } }
  }

  return {
    tags: [spec.tag],
    operationId: operationId(spec),
    summary: spec.summary,
    ...(description ? { description } : {}),
    security: security(spec.auth, unsafe),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses,
  }
}

function operationId(spec: RouteSpec): string {
  const words = spec.path
    .replace(/^\/api\/v1\//, '')
    .replace(/\.json$/, 'Json')
    .split(/[/{}\-_.]+/)
    .filter(Boolean)
  const camel = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')
  return `${spec.method}${camel}`
}

export type GeneratedOperation = ReturnType<typeof buildOperation>

export function buildCatalogPaths(
  skip: Record<string, unknown>,
): Record<string, Partial<Record<Method, GeneratedOperation>>> {
  const paths: Record<string, Partial<Record<Method, GeneratedOperation>>> = {}
  for (const spec of routeCatalog) {
    if (spec.path in skip) {
      throw new Error(`OpenAPI catalog duplicates hand-written path ${spec.path}`)
    }
    paths[spec.path] ??= {}
    const item = paths[spec.path] as Partial<Record<Method, GeneratedOperation>>
    if (item[spec.method])
      throw new Error(`Duplicate OpenAPI catalog entry ${spec.method} ${spec.path}`)
    item[spec.method] = buildOperation(spec)
  }
  return paths
}
