import { HttpResponse, http } from 'msw'

export const handlers = [
  http.get('https://musicbrainz.org/ws/2/artist', () => {
    return HttpResponse.json({
      artists: [
        {
          id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
          name: 'Radiohead',
          score: 100,
          tags: [{ name: 'rock', count: 10 }],
          'life-span': { begin: '1985', end: null },
        },
      ],
    })
  }),

  http.get('https://musicbrainz.org/ws/2/artist/:mbid', ({ params }) => {
    return HttpResponse.json({
      id: params.mbid,
      name: 'Radiohead',
      disambiguation: '',
      tags: [{ name: 'rock', count: 10 }],
      relations: [],
      'life-span': { begin: '1985', end: null },
    })
  }),

  http.get('https://ws.audioscrobbler.com/2.0/', ({ request }) => {
    const url = new URL(request.url)
    const method = url.searchParams.get('method')
    if (method === 'artist.getsimilar') {
      return HttpResponse.json({
        similarartists: {
          artist: [
            { name: 'Thom Yorke', match: '0.9', mbid: 'fake-mbid-1' },
            { name: 'Atoms for Peace', match: '0.8', mbid: 'fake-mbid-2' },
          ],
        },
      })
    }
    return HttpResponse.json({ error: 'Unknown method' })
  }),

  http.get('http://localhost:8686/api/v1/artist', () => {
    return HttpResponse.json([])
  }),

  http.get('https://api.deezer.com/search/artist', () => {
    return HttpResponse.json({
      data: [{ id: 399, name: 'Radiohead', nb_fan: 5000000, picture_medium: '' }],
    })
  }),

  http.get('https://webservice.fanart.tv/v3/music/:mbid', () => {
    return HttpResponse.json({})
  }),
]
