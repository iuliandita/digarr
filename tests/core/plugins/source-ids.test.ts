import { describe, expect, it } from 'vitest'
import { createDiscogsSource } from '@/core/plugins/discogs'
import { createEmbySource } from '@/core/plugins/emby'
import { createJellyfinSource } from '@/core/plugins/jellyfin'
import { createLastFmSource } from '@/core/plugins/lastfm'
import { createListenBrainzSource } from '@/core/plugins/listenbrainz'
import { createPlexSource } from '@/core/plugins/plex'
import { LISTENING_SOURCE_IDS } from '@/core/plugins/registry'
import { createSpotifySource } from '@/core/plugins/spotify'
import { createSubsonicSource } from '@/core/plugins/subsonic'

describe('LISTENING_SOURCE_IDS', () => {
  it('every registrable source id appears in LISTENING_SOURCE_IDS', () => {
    const sources = [
      createListenBrainzSource('u', 't'),
      createLastFmSource('u', 'k'),
      createSpotifySource('token'),
      createPlexSource('http://x', 't', undefined),
      createJellyfinSource('http://x', 'k', 'uid', false, undefined),
      createEmbySource('http://x', 'k', 'uid', false, undefined),
      createDiscogsSource('t', 'u'),
      createSubsonicSource('http://x', 'u', 'p', false),
    ]
    expect(new Set(sources.map((s) => s.id))).toEqual(new Set(LISTENING_SOURCE_IDS))
  })
})
