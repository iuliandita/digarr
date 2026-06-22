// Hand-written OpenAPI 3.1 contract. It intentionally grows by stable route
// group instead of migrating every Hono route through a generation framework in
// one pass.

import { VERSION } from '@/version'

const json = 'application/json'
const problemJson = 'application/problem+json'
const authSecurity = [{ sessionCookie: [] }, { bearerToken: [] }]
const problemResponse = { $ref: '#/components/responses/BadRequest' }
const validationResponse = { $ref: '#/components/responses/ValidationFailed' }
const unauthenticatedResponse = { $ref: '#/components/responses/Unauthenticated' }
const forbiddenResponse = { $ref: '#/components/responses/Forbidden' }
const notFoundResponse = { $ref: '#/components/responses/NotFound' }

function jsonSchema(ref: string) {
  return { content: { [json]: { schema: { $ref: ref } } } }
}

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
      User: {
        type: 'object',
        required: ['id', 'username', 'isAdmin'],
        properties: {
          id: { type: 'integer' },
          username: { type: 'string' },
          isAdmin: { type: 'boolean' },
          preferredLocale: { type: ['string', 'null'] },
        },
        additionalProperties: true,
      },
      AuthStatus: {
        type: 'object',
        required: ['authenticated', 'required', 'hasUsers', 'oidcEnabled'],
        properties: {
          authenticated: { type: 'boolean' },
          userId: { type: 'integer' },
          isAdmin: { type: 'boolean' },
          required: { type: 'boolean' },
          hasUsers: { type: 'boolean' },
          oidcEnabled: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      AuthTokenResponse: {
        type: 'object',
        required: ['user', 'token'],
        properties: {
          user: { $ref: '#/components/schemas/User' },
          token: { type: 'string' },
        },
        additionalProperties: true,
      },
      Recommendation: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'integer' },
          kind: {
            type: 'string',
            enum: ['artist', 'album'],
            description: 'Whether this recommendation is for an artist or a specific album.',
          },
          status: { type: 'string' },
          score: { type: 'number' },
          artist: { type: 'object', additionalProperties: true },
        },
        additionalProperties: true,
      },
      RecommendationList: {
        type: 'object',
        required: ['items', 'total'],
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/Recommendation' },
          },
          total: { type: 'integer' },
        },
        additionalProperties: true,
      },
      RecommendationUpdateResult: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string' },
          targetActions: { type: 'object', additionalProperties: true },
          lidarrError: { type: 'string' },
        },
        additionalProperties: true,
      },
      ArtistBlock: {
        type: 'object',
        required: ['artistId'],
        properties: {
          artistId: { type: 'integer' },
          artistName: { type: 'string' },
          reason: { type: ['string', 'null'] },
          reasonText: { type: ['string', 'null'] },
        },
        additionalProperties: true,
      },
      ArtistBlockList: {
        type: 'object',
        required: ['items', 'nextCursor'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/ArtistBlock' } },
          nextCursor: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
      JobRun: {
        type: 'object',
        required: ['id', 'type', 'status'],
        properties: {
          id: { type: 'integer' },
          type: { type: 'string' },
          status: { type: 'string' },
          startedAt: { type: 'string', format: 'date-time' },
          completedAt: { type: ['string', 'null'], format: 'date-time' },
          error: { type: ['string', 'null'] },
        },
        additionalProperties: true,
      },
      JobList: {
        type: 'object',
        required: ['items', 'total'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/JobRun' } },
          total: { type: 'integer' },
        },
        additionalProperties: false,
      },
      JobHealth: {
        type: 'object',
        required: ['pipeline', 'subscriptions', 'playlists', 'sources'],
        properties: {
          pipeline: { type: 'object', additionalProperties: true },
          subscriptions: { type: 'object', additionalProperties: true },
          playlists: { type: 'object', additionalProperties: true },
          sources: { type: 'object', additionalProperties: true },
        },
        additionalProperties: true,
      },
      ProbeSuccess: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          version: { type: 'string' },
          latencyMs: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    responses: {
      BadRequest: {
        description: 'Malformed request, missing input, or unsupported option.',
        content: {
          [problemJson]: { schema: { $ref: '#/components/schemas/Problem' } },
        },
      },
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
      ProbeFailed: {
        description: 'The upstream service probe failed.',
        content: {
          [problemJson]: { schema: { $ref: '#/components/schemas/Problem' } },
        },
      },
    },
  },
  security: [{ sessionCookie: [] }, { bearerToken: [] }],
  paths: {
    '/api/v1/auth/status': {
      get: {
        tags: ['Auth'],
        operationId: 'getAuthStatus',
        summary: 'Get public auth requirement status',
        security: [],
        responses: {
          '200': { description: 'Auth status.', ...jsonSchema('#/components/schemas/AuthStatus') },
          '400': problemResponse,
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Auth'],
        operationId: 'login',
        summary: 'Create a session from username and password',
        security: [],
        requestBody: {
          required: true,
          content: {
            [json]: {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string', format: 'password' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Authenticated session.',
            ...jsonSchema('#/components/schemas/AuthTokenResponse'),
          },
          '400': validationResponse,
          '401': unauthenticatedResponse,
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/v1/recommendations': {
      get: {
        tags: ['Recommendations'],
        operationId: 'listRecommendations',
        summary: 'List recommendations with offset pagination',
        security: authSecurity,
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'batchId', in: 'query', schema: { type: 'integer' } },
          {
            name: 'kind',
            in: 'query',
            schema: { type: 'string', enum: ['artist', 'album'] },
            description: 'Filter by recommendation kind. Omit to return both artists and albums.',
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': {
            description: 'Recommendation page.',
            ...jsonSchema('#/components/schemas/RecommendationList'),
          },
          '400': validationResponse,
          '401': unauthenticatedResponse,
        },
      },
    },
    '/api/v1/recommendations/{id}': {
      get: {
        tags: ['Recommendations'],
        operationId: 'getRecommendation',
        summary: 'Get one recommendation',
        security: authSecurity,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'Recommendation.',
            ...jsonSchema('#/components/schemas/Recommendation'),
          },
          '400': validationResponse,
          '401': unauthenticatedResponse,
          '404': notFoundResponse,
        },
      },
      patch: {
        tags: ['Recommendations'],
        operationId: 'updateRecommendation',
        summary: 'Approve, reject, or restore a recommendation',
        security: authSecurity,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { [json]: { schema: { type: 'object' } } } },
        responses: {
          '200': {
            description: 'Updated recommendation status.',
            ...jsonSchema('#/components/schemas/RecommendationUpdateResult'),
          },
          '400': validationResponse,
          '401': unauthenticatedResponse,
          '404': notFoundResponse,
        },
      },
    },
    '/api/v1/artist-blocks': {
      get: {
        tags: ['Artist blocks'],
        operationId: 'listArtistBlocks',
        summary: 'List blocked artists with cursor pagination',
        security: authSecurity,
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Artist block page.',
            ...jsonSchema('#/components/schemas/ArtistBlockList'),
          },
          '400': validationResponse,
          '401': unauthenticatedResponse,
        },
      },
      post: {
        tags: ['Artist blocks'],
        operationId: 'createArtistBlock',
        summary: 'Block an artist for the current user',
        security: authSecurity,
        requestBody: { required: true, content: { [json]: { schema: { type: 'object' } } } },
        responses: {
          '204': { description: 'Artist block created.' },
          '400': validationResponse,
          '401': unauthenticatedResponse,
        },
      },
    },
    '/api/v1/artist-blocks/{artistId}': {
      delete: {
        tags: ['Artist blocks'],
        operationId: 'deleteArtistBlock',
        summary: 'Remove an artist block',
        security: authSecurity,
        parameters: [{ name: 'artistId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '204': { description: 'Artist block removed.' },
          '400': validationResponse,
          '401': unauthenticatedResponse,
          '404': notFoundResponse,
        },
      },
    },
    '/api/v1/jobs': {
      get: {
        tags: ['Jobs'],
        operationId: 'listJobs',
        summary: 'List job runs with offset pagination',
        security: authSecurity,
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': { description: 'Job page.', ...jsonSchema('#/components/schemas/JobList') },
          '400': validationResponse,
          '401': unauthenticatedResponse,
          '403': forbiddenResponse,
        },
      },
    },
    '/api/v1/jobs/{id}': {
      get: {
        tags: ['Jobs'],
        operationId: 'getJob',
        summary: 'Get one job run',
        security: authSecurity,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Job run.', ...jsonSchema('#/components/schemas/JobRun') },
          '400': validationResponse,
          '401': unauthenticatedResponse,
          '403': forbiddenResponse,
          '404': notFoundResponse,
        },
      },
    },
    '/api/v1/jobs/health': {
      get: {
        tags: ['Jobs'],
        operationId: 'getJobHealth',
        summary: 'Get job system health',
        security: authSecurity,
        responses: {
          '200': {
            description: 'Job health summary.',
            ...jsonSchema('#/components/schemas/JobHealth'),
          },
          '400': problemResponse,
          '401': unauthenticatedResponse,
          '403': forbiddenResponse,
        },
      },
    },
    '/api/v1/settings/test/{service}': {
      post: {
        tags: ['Settings'],
        operationId: 'testServiceConnection',
        summary: 'Test an external service connection',
        security: authSecurity,
        parameters: [{ name: 'service', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: false, content: { [json]: { schema: { type: 'object' } } } },
        responses: {
          '200': {
            description: 'Probe succeeded.',
            ...jsonSchema('#/components/schemas/ProbeSuccess'),
          },
          '400': problemResponse,
          '401': unauthenticatedResponse,
          '403': forbiddenResponse,
          '502': { $ref: '#/components/responses/ProbeFailed' },
        },
      },
    },
  },
} as const
