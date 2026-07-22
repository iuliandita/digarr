// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openapiDoc } from '@/server/helpers/openapi-doc'
import { registerSchema } from '@/server/schemas/auth'

describe('OpenAPI skeleton', () => {
  it('declares a valid 3.1 document shape', () => {
    expect(openapiDoc.openapi).toBe('3.1.0')
    expect(openapiDoc.info?.title).toBe('digarr API')
    expect(typeof openapiDoc.info?.version).toBe('string')
  })

  it('declares session cookie and bearer security schemes', () => {
    const schemes = openapiDoc.components?.securitySchemes
    expect(schemes?.sessionCookie?.type).toBe('apiKey')
    expect(schemes?.bearerToken?.scheme).toBe('bearer')
  })

  it('declares distinct token and cookie response contracts', () => {
    const { AuthTokenResponse, AuthCookieResponse } = openapiDoc.components.schemas

    expect(AuthTokenResponse.required).toContain('token')
    expect(AuthCookieResponse.required).toContain('user')
    expect(AuthCookieResponse.additionalProperties).toBe(false)
  })

  it('declares the CSRF header security scheme with the required literal value', () => {
    const schemes = openapiDoc.components.securitySchemes as Readonly<
      Record<string, { type?: string; in?: string; name?: string; description?: string }>
    >

    expect(schemes.csrfHeader).toEqual(
      expect.objectContaining({ type: 'apiKey', in: 'header', name: 'X-Digarr-CSRF' }),
    )
    expect(schemes.csrfHeader?.description).toContain('`1`')
  })

  it('documents cookie-mode negotiation on password login', () => {
    const login = openapiDoc.paths['/api/v1/auth/login'].post

    expect(login.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'X-Digarr-Auth-Mode', in: 'header' }),
      ]),
    )
    expect(login.responses['200']?.content?.['application/json']?.schema?.oneOf).toEqual([
      { $ref: '#/components/schemas/AuthTokenResponse' },
      { $ref: '#/components/schemas/AuthCookieResponse' },
    ])
  })

  it('documents registration negotiation, dual 201 response, and actual errors', () => {
    const register = openapiDoc.paths['/api/v1/auth/register'].post

    expect(register.security).toEqual([])
    expect(register.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'X-Digarr-Auth-Mode', in: 'header' }),
      ]),
    )
    expect(register.responses['201'].content?.['application/json']?.schema?.oneOf).toEqual([
      { $ref: '#/components/schemas/AuthTokenResponse' },
      { $ref: '#/components/schemas/AuthCookieResponse' },
    ])
    expect(register.responses['403']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ErrorResponse',
    })
    expect(register.responses['409']?.content?.['application/problem+json']?.schema).toEqual({
      $ref: '#/components/schemas/Problem',
    })
    expect(register.responses['429']).toEqual({ $ref: '#/components/responses/RateLimited' })
  })

  it.each([
    ['one normalized character', ' a ', false],
    ['two normalized characters', ' ab ', true],
    ['50 normalized characters', ` ${'a'.repeat(50)} `, true],
    ['51 normalized characters', ` ${'a'.repeat(51)} `, false],
  ])('enforces %s after trimming', (_case, username, valid) => {
    expect(registerSchema.safeParse({ username, password: 'longenough12' }).success).toBe(valid)
  })

  it('documents normalized registration username limits without raw length keywords', () => {
    const username =
      openapiDoc.paths['/api/v1/auth/register'].post.requestBody.content['application/json'].schema
        .properties.username

    expect(username).not.toHaveProperty('minLength')
    expect(username).not.toHaveProperty('maxLength')
    expect(username.description).toBe(
      'Surrounding whitespace is trimmed before enforcing a normalized length of 2-50 characters.',
    )
  })

  it('documents conditional CSRF headers on public browser mutations', () => {
    for (const [path, operation] of [
      ['/api/v1/auth/login', openapiDoc.paths['/api/v1/auth/login'].post],
      ['/api/v1/auth/register', openapiDoc.paths['/api/v1/auth/register'].post],
    ] as const) {
      expect(operation.parameters, path).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'X-Digarr-CSRF',
            in: 'header',
            required: false,
            schema: expect.objectContaining({ const: '1' }),
          }),
        ]),
      )
    }
  })

  it('documents bearer-only session migration into a cookie', () => {
    const migration = openapiDoc.paths['/api/v1/auth/session/migrate'].post

    expect(migration.security).toEqual([{ bearerToken: [] }])
    expect(migration.responses).toHaveProperty('204')
    expect(migration.responses).toHaveProperty('403')
    expect(migration.responses).toHaveProperty('409')
  })

  it('declares the Problem and ValidationError schemas', () => {
    const schemas = openapiDoc.components?.schemas
    expect(schemas?.Problem?.required).toContain('status')
    expect(schemas?.ValidationError?.required).toContain('code')
  })

  it('declares the standard response envelopes', () => {
    const responses = openapiDoc.components?.responses
    for (const key of [
      'Unauthenticated',
      'Forbidden',
      'NotFound',
      'ValidationFailed',
      'RateLimited',
    ]) {
      expect(responses?.[key as keyof typeof responses]).toBeDefined()
    }
  })

  it('documents the first stable external-facing route groups', () => {
    expect(Object.keys(openapiDoc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/status',
        '/api/v1/auth/login',
        '/api/v1/auth/register',
        '/api/v1/auth/session/migrate',
        '/api/v1/recommendations',
        '/api/v1/recommendations/{id}',
        '/api/v1/artist-blocks',
        '/api/v1/artist-blocks/{artistId}',
        '/api/v1/jobs',
        '/api/v1/jobs/{id}',
        '/api/v1/jobs/health',
        '/api/v1/settings/test/{service}',
      ]),
    )
  })

  it('documents admin reconciliation review reads and bulk ignores', () => {
    const paths = openapiDoc.paths as Record<
      string,
      {
        get?: {
          security?: unknown
          responses: Record<string, unknown>
        }
        post?: {
          security?: unknown
          requestBody?: {
            required?: boolean
            content?: Record<string, { schema?: unknown }>
          }
          responses: Record<string, unknown>
        }
      }
    >
    const schemas = openapiDoc.components.schemas as Record<string, Record<string, unknown>>

    const artistRows = paths['/api/v1/library/unreconciled']?.get
    const albumRows = paths['/api/v1/library/unreconciled-albums']?.get
    const artistBulkIgnore = paths['/api/v1/library/overrides/bulk-ignore']?.post
    const albumBulkIgnore = paths['/api/v1/library/album-overrides/bulk-ignore']?.post

    expect(artistRows).toBeDefined()
    expect(albumRows).toBeDefined()
    expect(artistBulkIgnore).toBeDefined()
    expect(albumBulkIgnore).toBeDefined()

    for (const [operation, responseSchema] of [
      [artistRows, '#/components/schemas/LibraryUnreconciledArtistList'],
      [albumRows, '#/components/schemas/LibraryUnreconciledAlbumList'],
    ] as const) {
      expect(operation?.security).toEqual([{ sessionCookie: [] }, { bearerToken: [] }])
      expect(operation?.responses).toEqual(
        expect.objectContaining({
          '200': expect.anything(),
          '401': expect.anything(),
          '403': expect.anything(),
        }),
      )
      expect(operation?.responses['200']).toMatchObject({
        content: { 'application/json': { schema: { $ref: responseSchema } } },
      })
    }

    for (const [operation, requestSchema] of [
      [artistBulkIgnore, '#/components/schemas/LibraryArtistBulkIgnoreRequest'],
      [albumBulkIgnore, '#/components/schemas/LibraryAlbumBulkIgnoreRequest'],
    ] as const) {
      expect(operation?.security).toEqual([
        { sessionCookie: [], csrfHeader: [] },
        { bearerToken: [] },
      ])
      expect(operation?.responses).toEqual(
        expect.objectContaining({
          '204': expect.anything(),
          '400': expect.anything(),
          '401': expect.anything(),
          '403': expect.anything(),
        }),
      )
      expect(operation?.requestBody).toEqual({
        required: true,
        content: { 'application/json': { schema: { $ref: requestSchema } } },
      })
    }

    for (const [requestSchema, identityRef] of [
      [schemas.LibraryArtistBulkIgnoreRequest, '#/components/schemas/LibraryArtistIdentity'],
      [schemas.LibraryAlbumBulkIgnoreRequest, '#/components/schemas/LibraryAlbumIdentity'],
    ]) {
      expect(requestSchema).toMatchObject({
        type: 'object',
        required: ['items'],
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            uniqueItems: true,
            description: 'Exact duplicate identity pairs return 400.',
            items: { $ref: identityRef },
          },
        },
      })
    }
  })

  it('documents strict reconciliation response rows with nullable legacy reasons', () => {
    const schemas = openapiDoc.components.schemas as Record<string, Record<string, unknown>>

    for (const [identitySchema, required] of [
      [schemas.LibraryArtistIdentity, ['source', 'sourceArtistId']],
      [schemas.LibraryAlbumIdentity, ['source', 'sourceAlbumId']],
    ]) {
      expect(identitySchema).toMatchObject({
        type: 'object',
        required,
        additionalProperties: false,
      })
    }

    for (const listSchema of [
      schemas.LibraryUnreconciledArtistList,
      schemas.LibraryUnreconciledAlbumList,
    ]) {
      expect(listSchema).toMatchObject({
        type: 'object',
        required: ['items'],
        additionalProperties: false,
      })
    }

    for (const [rowSchema, required] of [
      [
        schemas.LibraryUnreconciledArtistRow,
        [
          'id',
          'userId',
          'source',
          'sourceArtistId',
          'name',
          'nameNormalized',
          'mbid',
          'matchMethod',
          'matchConfidence',
          'unreconciledReason',
          'genres',
          'syncedAt',
          'lastGapCheckAt',
        ],
      ],
      [
        schemas.LibraryUnreconciledAlbumRow,
        [
          'id',
          'userId',
          'source',
          'sourceArtistId',
          'sourceAlbumId',
          'title',
          'titleNormalized',
          'albumMbid',
          'artistMbid',
          'primaryType',
          'releaseYear',
          'matchMethod',
          'matchConfidence',
          'unreconciledReason',
          'syncedAt',
        ],
      ],
    ]) {
      expect(rowSchema).toMatchObject({
        type: 'object',
        required,
        additionalProperties: false,
        properties: {
          unreconciledReason: {
            oneOf: [
              { type: 'string', enum: ['no_candidate', 'ambiguous', 'lookup_failed'] },
              { type: 'null' },
            ],
          },
        },
      })
    }

    expect(schemas.LibraryUnreconciledArtistRow).toMatchObject({
      properties: {
        lastGapCheckAt: { type: ['string', 'null'], format: 'date-time' },
      },
    })
    expect(schemas.LibraryUnreconciledAlbumRow).toMatchObject({
      properties: {
        matchMethod: { type: ['string', 'null'] },
        matchConfidence: { type: ['number', 'null'] },
      },
    })
  })

  it('gives each added operation security, a success response, and common errors', () => {
    const publicPaths = new Set([
      '/api/v1/auth/status',
      '/api/v1/auth/login',
      '/api/v1/auth/register',
    ])
    const bearerOnlyPaths = new Set(['/api/v1/auth/session/migrate'])
    const noBadRequestPaths = new Set([
      '/api/v1/library/unreconciled',
      '/api/v1/library/unreconciled-albums',
    ])
    for (const [path, item] of Object.entries(openapiDoc.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const responseStatuses = Object.keys(operation.responses)
        expect(
          responseStatuses.some((status) => /^2\d\d$/.test(status)),
          `${method.toUpperCase()} ${path}`,
        ).toBe(true)
        if (publicPaths.has(path)) {
          expect(operation.security, `${method.toUpperCase()} ${path}`).toEqual([])
        } else if (bearerOnlyPaths.has(path)) {
          expect(operation.security, `${method.toUpperCase()} ${path}`).toEqual([
            { bearerToken: [] },
          ])
          expect(operation.responses, `${method.toUpperCase()} ${path}`).toHaveProperty('401')
        } else if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
          expect(operation.security, `${method.toUpperCase()} ${path}`).toEqual([
            { sessionCookie: [] },
            { bearerToken: [] },
          ])
          expect(operation.responses, `${method.toUpperCase()} ${path}`).toHaveProperty('401')
        } else {
          expect(operation.security, `${method.toUpperCase()} ${path}`).toEqual([
            { sessionCookie: [], csrfHeader: [] },
            { bearerToken: [] },
          ])
          expect(operation.responses, `${method.toUpperCase()} ${path}`).toHaveProperty('401')
        }
        if (!noBadRequestPaths.has(path)) {
          expect(operation.responses, `${method.toUpperCase()} ${path}`).toHaveProperty('400')
        }
      }
    }
  })

  it('documents settings probe success and failure contracts', () => {
    const operation = openapiDoc.paths['/api/v1/settings/test/{service}'].post
    expect(operation.responses['200'].content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ProbeSuccess',
    })
    expect(operation.responses['502']).toEqual({ $ref: '#/components/responses/ProbeFailed' })
  })

  it('documents mutation success responses with the real handler shapes', () => {
    const createBlock = openapiDoc.paths['/api/v1/artist-blocks'].post
    expect(createBlock.responses['204']).toEqual({ description: 'Artist block created.' })
    expect(createBlock.responses).not.toHaveProperty('200')

    const updateRecommendation = openapiDoc.paths['/api/v1/recommendations/{id}'].patch
    expect(updateRecommendation.responses['200'].content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/RecommendationUpdateResult',
    })
  })
})
