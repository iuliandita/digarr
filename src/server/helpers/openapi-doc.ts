// Hand-written OpenAPI 3.1 skeleton. This is intentionally a minimal
// starting point rather than a complete per-route spec: wiring every
// route through `@hono/zod-openapi` would be a large migration touching
// every route file. The skeleton documents the auth/session model and
// the top-level error envelopes so clients can integrate; detailed
// endpoint descriptions will be filled in as routes are next touched.
//
// The goal of publishing this today is to lock in the contract shape
// (problem+json envelope, error code surface, session token flow) so
// future additions slot in without breaking existing integrations.

import { VERSION } from '@/version'

export const openapiDoc = {
  openapi: '3.1.0',
  info: {
    title: 'digarr API',
    version: VERSION,
    description:
      'Backend API for digarr. Error responses follow RFC 9457 problem+json via the central error handler. Authentication is session-cookie OR `Authorization: Bearer <token>` per request.',
  },
  servers: [{ url: '/', description: 'Current deployment' }],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'digarr_session',
        description: 'Session cookie set by the login, OIDC, or proxy-auth flows.',
      },
      bearerToken: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Session token issued at login. Equivalent to the cookie; prefer the cookie for browser clients.',
      },
    },
    schemas: {
      Problem: {
        type: 'object',
        required: ['type', 'title', 'status'],
        properties: {
          type: {
            type: 'string',
            description: 'Relative problem-type slug, e.g. /problems/not-found.',
          },
          title: { type: 'string' },
          status: { type: 'integer' },
          detail: { type: 'string' },
        },
        additionalProperties: true,
      },
      ValidationError: {
        type: 'object',
        required: ['error', 'code', 'details'],
        properties: {
          error: { type: 'string' },
          code: { type: 'string', const: 'validation_failed' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              required: ['path', 'code', 'message'],
              properties: {
                path: {
                  type: 'array',
                  items: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
                },
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
    responses: {
      Unauthenticated: {
        description: 'Authentication required or invalid.',
        headers: {
          'WWW-Authenticate': {
            schema: { type: 'string' },
            description: 'Bearer challenge with realm',
          },
        },
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
        },
      },
      Forbidden: {
        description: 'Authenticated but not permitted.',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
        },
      },
      NotFound: {
        description: 'Resource not present (or hidden from the current caller).',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
        },
      },
      ValidationFailed: {
        description: 'Request body or query failed schema validation.',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } },
        },
      },
      RateLimited: {
        description: 'Too many requests.',
        headers: {
          'Retry-After': {
            schema: { type: 'integer' },
            description: 'Seconds to wait before retrying.',
          },
          'RateLimit-Policy': {
            schema: { type: 'string' },
            description: 'Quota; e.g. "10;w=60".',
          },
        },
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
        },
      },
    },
  },
  security: [{ sessionCookie: [] }, { bearerToken: [] }],
  // Paths block intentionally empty for now. Clients can introspect live
  // endpoints from the code; this surface will be filled in per-route as
  // the migration to @hono/zod-openapi proceeds.
  paths: {},
} as const
