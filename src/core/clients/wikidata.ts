import { createHttpClient } from './http'

export interface WikidataEnrichment {
  wikidataId: string | null
  description: string | null
  externalLinks: Record<string, string>
}

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'

function buildQuery(mbid: string, locale: string): string {
  const safeLocale = locale.replace(/[^a-zA-Z-]/g, '').slice(0, 10) || 'en'
  return `
    SELECT ?artist ?description ?wikipedia ?officialSite ?discogs WHERE {
      ?artist wdt:P434 "${mbid}" .
      OPTIONAL {
        ?artist schema:description ?description .
        FILTER(LANG(?description) = "${safeLocale}" || LANG(?description) = "en")
      }
      OPTIONAL {
        ?wikipedia schema:about ?artist ;
                   schema:isPartOf <https://${safeLocale}.wikipedia.org/> .
      }
      OPTIONAL {
        ?wikipediaEn schema:about ?artist ;
                     schema:isPartOf <https://en.wikipedia.org/> .
        FILTER(!BOUND(?wikipedia))
      }
      OPTIONAL { ?artist wdt:P856 ?officialSite . }
      OPTIONAL { ?artist wdt:P1953 ?discogs . }
    }
    LIMIT 1
  `.trim()
}

type SparqlBinding = Record<string, { value: string; 'xml:lang'?: string }>
type SparqlResponse = { results?: { bindings?: SparqlBinding[] } }

export type WikidataClient = ReturnType<typeof createWikidataClient>

export function createWikidataClient(baseUrl: string = SPARQL_ENDPOINT) {
  const http = createHttpClient({
    baseUrl,
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': 'digarr/1.0 (https://github.com/iuliandita/digarr)',
    },
    retries: 1,
    timeout: 10_000,
    publicIpOnly: true,
  })

  return {
    async getArtistEnrichment(mbid: string, locale: string): Promise<WikidataEnrichment> {
      const empty: WikidataEnrichment = {
        wikidataId: null,
        description: null,
        externalLinks: {},
      }
      try {
        const query = buildQuery(mbid, locale)
        const res = await http.get<SparqlResponse>(
          `?query=${encodeURIComponent(query)}&format=json`,
        )
        const binding = res.results?.bindings?.[0]
        if (!binding) return empty
        const qidUrl = binding.artist?.value
        const wikidataId = qidUrl ? (qidUrl.split('/').pop() ?? null) : null
        const description = binding.description?.value ?? null
        const links: Record<string, string> = {}
        if (binding.wikipedia?.value) links.wikipedia = binding.wikipedia.value
        if (binding.officialSite?.value) links.officialSite = binding.officialSite.value
        if (binding.discogs?.value) {
          links.discogs = `https://www.discogs.com/artist/${binding.discogs.value}`
        }
        return { wikidataId, description, externalLinks: links }
      } catch {
        return empty
      }
    },
  }
}
