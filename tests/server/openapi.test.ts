// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openapiDoc } from '@/server/helpers/openapi-doc'

type SchemaProperty = {
  $ref?: string
  type?: string | readonly string[]
}

type ObjectSchema = {
  type?: string
  required?: readonly string[]
  properties?: Readonly<Record<string, SchemaProperty>>
  additionalProperties?: boolean
}

type Operation = {
  parameters?: ReadonlyArray<{
    name?: string
    in?: string
    required?: boolean
    schema?: { const?: string }
  }>
  responses: Readonly<
    Record<
      string,
      {
        content?: Readonly<
          Record<string, { schema?: { $ref?: string; oneOf?: ReadonlyArray<{ $ref: string }> } }>
        >
      }
    >
  >
  security?: readonly Readonly<Record<string, readonly never[]>>[]
}

const paths = openapiDoc.paths as unknown as Readonly<
  Record<string, Readonly<Record<string, Operation>>>
>
const schemas = openapiDoc.components.schemas as unknown as Readonly<Record<string, ObjectSchema>>

function schemaName(ref: string): string {
  return ref.split('/').at(-1) ?? ''
}

function matchesType(type: string | readonly string[] | undefined, value: unknown): boolean {
  if (type === undefined) return true
  if (Array.isArray(type)) return type.some((candidate) => matchesType(candidate, value))
  if (type === 'null') return value === null
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value)
  return typeof value === type
}

function matchesSchema(ref: string, value: unknown): boolean {
  const schema = schemas[schemaName(ref)]
  if (!schema || !matchesType(schema.type, value)) return false
  if (schema.type !== 'object' || !value || typeof value !== 'object' || Array.isArray(value)) {
    return true
  }

  const record = value as Record<string, unknown>
  if (schema.required?.some((key) => !(key in record))) return false
  if (
    schema.additionalProperties === false &&
    Object.keys(record).some((key) => !(key in (schema.properties ?? {})))
  ) {
    return false
  }

  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (!(key in record)) continue
    if (property.$ref && !matchesSchema(property.$ref, record[key])) return false
    if (!property.$ref && !matchesType(property.type, record[key])) return false
  }
  return true
}

function responseVariants(operation: Operation, status: string): ReadonlyArray<{ $ref: string }> {
  return operation.responses[status]?.content?.['application/json']?.schema?.oneOf ?? []
}

function countMatchingVariants(variants: ReadonlyArray<{ $ref: string }>, value: unknown): number {
  return variants.filter((variant) => matchesSchema(variant.$ref, value)).length
}

const representativeUser = { id: 1, username: 'admin', isAdmin: true }
const cookieResponse = { user: representativeUser }
const bearerResponse = { user: representativeUser, token: 'session-token' }

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

  it('keeps representative login cookie and bearer responses disjoint', () => {
    const login = paths['/api/v1/auth/login']?.post
    expect(login).toBeDefined()
    if (!login) return
    const variants = responseVariants(login, '200')

    expect(variants).toHaveLength(2)
    expect(countMatchingVariants(variants, cookieResponse)).toBe(1)
    expect(countMatchingVariants(variants, bearerResponse)).toBe(1)
  })

  it('documents registration negotiation, dual 201 response, and actual errors', () => {
    const register = paths['/api/v1/auth/register']?.post
    expect(register).toBeDefined()
    if (!register) return

    expect(register.security).toEqual([])
    expect(register.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'X-Digarr-Auth-Mode', in: 'header' }),
      ]),
    )
    expect(responseVariants(register, '201')).toEqual([
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

  it('keeps representative register cookie and bearer responses disjoint', () => {
    const register = paths['/api/v1/auth/register']?.post
    expect(register).toBeDefined()
    if (!register) return
    const variants = responseVariants(register, '201')

    expect(variants).toHaveLength(2)
    expect(countMatchingVariants(variants, cookieResponse)).toBe(1)
    expect(countMatchingVariants(variants, bearerResponse)).toBe(1)
  })

  it('documents conditional CSRF headers on public browser mutations', () => {
    for (const path of ['/api/v1/auth/login', '/api/v1/auth/register']) {
      const operation = paths[path]?.post
      expect(operation, path).toBeDefined()
      expect(operation?.parameters, path).toEqual(
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

  it('gives each added operation security, a success response, and common errors', () => {
    const publicPaths = new Set([
      '/api/v1/auth/status',
      '/api/v1/auth/login',
      '/api/v1/auth/register',
    ])
    const bearerOnlyPaths = new Set(['/api/v1/auth/session/migrate'])
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
        expect(operation.responses, `${method.toUpperCase()} ${path}`).toHaveProperty('400')
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
