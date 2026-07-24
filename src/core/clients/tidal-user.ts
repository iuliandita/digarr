// User-authed TIDAL client (Authorization Code + PKCE). Separate from the
// client-credentials client in `tidal.ts`: app tokens can read the catalog but
// never `/me` collection data, so the two flows cannot share a client.

import { createHttpClient } from '@/core/clients/http'

const DEFAULT_BASE_URL = 'https://openapi.tidal.com/v2'

export type TidalUserArtist = {
  id: string
  name: string
  popularity?: number
  url?: string
  imageUrl?: string
}

type TidalResourceIdentifier = {
  id?: string
  type?: string
}

type TidalArtistAttributes = {
  name?: string
  popularity?: number
  externalLinks?: Array<{ href?: string; meta?: { type?: string } }>
  imageLinks?: Array<{ href?: string; meta?: { width?: number } }>
}

type TidalIncludedResource = {
  id?: string
  type?: string
  attributes?: TidalArtistAttributes
}

type TidalRelationshipDocument = {
  data?: TidalResourceIdentifier[]
  included?: TidalIncludedResource[]
  links?: { next?: string; self?: string }
}

/** Pull the opaque `page[cursor]` value out of a JSON:API `links.next` URL. */
function extractCursor(next: string | undefined): string | null {
  if (!next) return null
  try {
    const url = new URL(next, DEFAULT_BASE_URL)
    return url.searchParams.get('page[cursor]')
  } catch {
    return null
  }
}

function extractUrl(attrs: TidalArtistAttributes, id: string): string {
  const tidalLink = attrs.externalLinks?.find((l) => l.meta?.type === 'TIDAL_SHARING')
  return tidalLink?.href ?? `https://tidal.com/artist/${id}`
}

function extractImageUrl(attrs: TidalArtistAttributes): string | undefined {
  return attrs.imageLinks?.[0]?.href ?? undefined
}

export function createTidalUserClient(accessToken: string, options: { baseUrl?: string } = {}) {
  const http = createHttpClient({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.api+json',
    },
  })

  /**
   * Favorite ("collection") artists for the authenticated user, newest first.
   * TIDAL exposes no separate followed-artists list - the collection is the
   * only user-artist signal in the public API.
   */
  async function getFavoriteArtists(limit = 100): Promise<TidalUserArtist[]> {
    const artists: TidalUserArtist[] = []
    const seen = new Set<string>()
    let cursor: string | null = null

    while (artists.length < limit) {
      const params = new URLSearchParams({
        include: 'items',
        sort: '-addedAt',
        locale: 'en-US',
      })
      if (cursor) params.set('page[cursor]', cursor)

      const doc: TidalRelationshipDocument = await http.get<TidalRelationshipDocument>(
        `/userCollectionArtists/me/relationships/items?${params}`,
      )

      const byId = new Map<string, TidalArtistAttributes>()
      for (const inc of doc.included ?? []) {
        if (inc.type === 'artists' && inc.id) byId.set(inc.id, inc.attributes ?? {})
      }

      const identifiers = doc.data ?? []
      for (const ref of identifiers) {
        if (!ref.id || seen.has(ref.id)) continue
        const attrs = byId.get(ref.id)
        const name = attrs?.name?.trim()
        if (!name) continue
        seen.add(ref.id)
        artists.push({
          id: ref.id,
          name,
          popularity: attrs?.popularity,
          url: extractUrl(attrs ?? {}, ref.id),
          imageUrl: extractImageUrl(attrs ?? {}),
        })
        if (artists.length >= limit) break
      }

      cursor = extractCursor(doc.links?.next)
      if (!cursor || identifiers.length === 0) break
    }

    return artists.slice(0, limit)
  }

  return { getFavoriteArtists }
}
