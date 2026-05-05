// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openapiDoc } from '@/server/helpers/openapi-doc'

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
    const publicPaths = new Set(['/api/v1/auth/status', '/api/v1/auth/login'])
    for (const [path, item] of Object.entries(openapiDoc.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const responseStatuses = Object.keys(operation.responses)
        expect(
          responseStatuses.some((status) => /^2\d\d$/.test(status)),
          `${method.toUpperCase()} ${path}`,
        ).toBe(true)
        if (!publicPaths.has(path)) {
          expect(operation.security, `${method.toUpperCase()} ${path}`).toEqual([
            { sessionCookie: [] },
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
