import type { ExportableRecommendation } from './types'
import { getStreamingUrl } from './types'

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function exportToXspf(
  recommendations: ExportableRecommendation[],
  options?: { title?: string; creator?: string },
): string {
  const title = options?.title ?? 'Digarr Recommendations'
  const creator = options?.creator ?? 'Digarr'

  if (recommendations.length === 0) {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<playlist version="1" xmlns="http://xspf.org/ns/0/">',
      `  <title>${escapeXml(title)}</title>`,
      `  <creator>${escapeXml(creator)}</creator>`,
      '  <trackList/>',
      '</playlist>',
    ].join('\n')
  }

  const tracks = recommendations.map((rec) => {
    const parts = ['    <track>']
    parts.push(`      <location>${escapeXml(getStreamingUrl(rec))}</location>`)
    parts.push(`      <creator>${escapeXml(rec.artistName)}</creator>`)
    parts.push(`      <title>${escapeXml(rec.recordingTitle ?? rec.artistName)}</title>`)
    if (rec.suggestedAlbum) {
      parts.push(`      <album>${escapeXml(rec.suggestedAlbum)}</album>`)
    }
    if (rec.aiReasoning) {
      parts.push(`      <annotation>${escapeXml(rec.aiReasoning)}</annotation>`)
    }
    if (rec.imageUrl) {
      parts.push(`      <image>${escapeXml(rec.imageUrl)}</image>`)
    }
    if (rec.recordingMbid) {
      parts.push(
        `      <identifier>https://musicbrainz.org/recording/${escapeXml(rec.recordingMbid)}</identifier>`,
      )
    }
    parts.push(`      <info>https://musicbrainz.org/artist/${escapeXml(rec.artistMbid)}</info>`)
    parts.push('    </track>')
    return parts.join('\n')
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<playlist version="1" xmlns="http://xspf.org/ns/0/">',
    `  <title>${escapeXml(title)}</title>`,
    `  <creator>${escapeXml(creator)}</creator>`,
    '  <trackList>',
    ...tracks,
    '  </trackList>',
    '</playlist>',
  ].join('\n')
}
