import { createHttpClient } from './http'

export interface WikidataEnrichment {
  wikidataId: string | null
  description: string | null
  externalLinks: Record<string, string>
}

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function buildQuery(mbid: string, locale: string): string {
  if (!UUID_RE.test(mbid)) throw new Error('Invalid MusicBrainz ID')
  const safeLocale = locale.replace(/[^a-zA-Z-]/g, '').slice(0, 10) || 'en'
  return `
    SELECT ?artist ?description ?wikipedia ?wikipediaEn ?officialSite ?discogs WHERE {
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
      // Transport/parse errors propagate so callers do not negative-cache an outage.
      const query = buildQuery(mbid, locale)
      const res = await http.get<SparqlResponse>(`?query=${encodeURIComponent(query)}&format=json`)
      const binding = res.results?.bindings?.[0]
      if (!binding) return empty
      const qidUrl = binding.artist?.value
      const wikidataId = qidUrl ? (qidUrl.split('/').pop() ?? null) : null
      const description = binding.description?.value ?? null
      const links: Record<string, string> = {}
      const wikipedia = binding.wikipedia?.value ?? binding.wikipediaEn?.value
      if (wikipedia) links.wikipedia = wikipedia
      if (binding.officialSite?.value) links.officialSite = binding.officialSite.value
      if (binding.discogs?.value) {
        links.discogs = `https://www.discogs.com/artist/${binding.discogs.value}`
      }
      return { wikidataId, description, externalLinks: links }
    },
  }
}
