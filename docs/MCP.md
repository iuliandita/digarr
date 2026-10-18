# MCP clients

Digarr serves Model Context Protocol (MCP) over Streamable HTTP at `/api/v1/mcp`. It runs inside the app alongside the REST API; no extra server or installer is needed.

## Connect

Open **Settings > Account > API tokens**, create a token, and copy the MCP client configuration before closing the dialog. Digarr builds the URL from the address you are browsing. Use your public Digarr address when creating it, and configure your reverse proxy to forward `/api/v1/mcp` and the `Authorization` header.

For a client that accepts `mcpServers` configuration:

```json
{
  "mcpServers": {
    "digarr": {
      "type": "http",
      "url": "https://digarr.example/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer dga_<your-token>"
      }
    }
  }
}
```

MCP client configuration formats differ slightly; this example uses the common remote HTTP shape. Choose Streamable HTTP if your client asks for a transport. A client that supports only stdio needs a compatible remote-MCP bridge. Treat the configuration as a password: it contains your full token. Revoke the token in Account settings to disconnect the client. See [personal API tokens](AUTHENTICATION.md#personal-api-tokens) for expiry, recovery, and revocation details.

Only personal API tokens in `Authorization: Bearer` authenticate this endpoint. Browser cookies, session bearer tokens, query tokens, the legacy deployment token, and trusted sign-in proxy headers do not grant MCP access. This also holds before initial setup. No token means no MCP access. Use HTTPS for remote connections.

## Permissions and tools

A `read` token can initialize, list tools, and call read tools, even though MCP uses HTTP POST for those requests. Mutating tools need `write` or `admin` scope. An admin-owned read/write token does not inherit admin access. Recommendations and playlists stay scoped to the token owner; job status exposes only that owner's job and excludes raw errors, metadata, and source payloads.

| Tool | Inputs | Access |
|------|--------|--------|
| `list_recommendations` | Optional `status`, `decades`, `kind`, `limit` (1-200), `offset` | Read |
| `get_recommendation` | `id` | Read; includes recommendation explanation and source scores |
| `approve_recommendation` | `id`; optional approval and target options from the REST approval API | Write |
| `reject_recommendation` | `id`; optional `reason`, `reasonText` | Write |
| `block_recommendation` | `id`; optional `reason`, `reasonText` | Write; permanent rejection |
| `run_scan` | None | Write |
| `run_discovery_mode` | `modeId`; optional `settingsMode`, `rawUserSettings`, `normalizedSettings` | Write |
| `get_scan_status` | None | Read |
| `get_job_status` | `id` | Read; own jobs only |
| `search_artists` | `query`; optional `limit` (1-50), `sources` | Read |
| `list_playlists` | Optional `limit` (1-100), `cursor` | Read |

Recommendation statuses match the [REST API](API.md#recommendations). `decades` is a comma-separated string such as `80s,90s`; a genre filter is not exposed. Rejection reasons are `already_own`, `wrong_style`, `not_interested`, `tried_didnt_like`, `not_right_now`, and `other`. Freeform `reasonText` is valid only with `other`, up to 200 characters. `not_right_now` cannot be a permanent block.

Approval uses the same target delivery and persistence path as REST, including album handling, target defaults, and failure status. Failed or partially failed approval delivery sets `isError: true` and retains safe status and per-target outcomes; provider error text is omitted. Review those outcomes before retrying. Request-only approvals return a clear request-created result with the request ID, rather than claiming the item was added. An exhausted open-request limit returns its own safe error instead of a scan-conflict message. A scan returns its enqueue outcome; poll `get_scan_status` for progress. A named discovery run returns a `jobId`; poll `get_job_status` for completion. Discovery mode IDs and settings match the [discovery mode API](API.md#discovery-modes). Each `rawUserSettings` or `normalizedSettings` record permits at most 64 keys (1-64 characters each) and 16 KiB of JSON.

## Transport and failures

The endpoint is stateless: every HTTP request authenticates the token again and creates a short-lived SDK server and transport. There is no MCP session store, session ID, resumability, or server-initiated event stream. POST accepts one JSON-RPC message per request. Batch arrays return `400`, and request bodies larger than 1 MiB return `413`, including streamed bodies without a Content-Length header. POST uses JSON responses; clients must accept both `application/json` and `text/event-stream` as required by Streamable HTTP. GET and DELETE return `405` (a read token cannot issue DELETE and receives `403`) because there is no persistent stream or session to manage.

The implementation pins the official `@modelcontextprotocol/sdk` v1 package at 1.32.1. This maintenance line implements MCP through protocol version `2025-11-25`. Its Web Standard transport works with Hono and Bun without Node HTTP adapters. Newer protocol versions supported only by the separate v2 packages are outside this endpoint's contract.

Authentication and rate-limit failures use the existing API HTTP status and problem-details responses: `401` for rejected credentials, `429` with `Retry-After` for an exhausted budget. Failed token authentication shares the REST limit of 20 attempts per minute per client IP. The MCP endpoint permits 120 requests per minute per client IP and user. The MCP `run_scan` and `run_discovery_mode` tools each allow five start requests per minute per user. These budgets apply only to MCP calls; the REST entry points retain their existing scan queue and single-flight behavior. Rate limits are in memory for one Digarr process. Tool validation, permission, lookup, and execution failures use MCP error results (`isError: true`) with secret-free messages. Raw provider exceptions and target credentials are not returned.

Requests without an `Origin` header work for remote clients. If a client sends `Origin`, it must match Digarr's configured `ALLOWED_ORIGIN`, or the request origin when no override is set. Configure the public origin correctly behind a reverse proxy; do not add cookies or disable token checks to work around a rejected client.
