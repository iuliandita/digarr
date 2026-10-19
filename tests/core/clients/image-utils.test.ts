// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { extractImages, toHttpsImageUrl } from '@/core/clients/image-utils'

describe('toHttpsImageUrl', () => {
  it.each([
    ['http://assets.fanart.tv/fanart/a.jpg', 'https://assets.fanart.tv/fanart/a.jpg'],
    ['http://www.theaudiodb.com/images/a.jpg', 'https://www.theaudiodb.com/images/a.jpg'],
    ['http://r2.theaudiodb.com/images/media/a.jpg', 'https://r2.theaudiodb.com/images/media/a.jpg'],
    ['HTTP://Assets.Fanart.TV/a.jpg?x=1', 'https://assets.fanart.tv/a.jpg?x=1'],
    ['https://assets.fanart.tv/a.jpg', 'https://assets.fanart.tv/a.jpg'],
    ['http://nas.local:8080/a.jpg', 'http://nas.local:8080/a.jpg'],
    ['http://evil.example/theaudiodb.com/a.jpg', 'http://evil.example/theaudiodb.com/a.jpg'],
    ['not a url', 'not a url'],
    [undefined, undefined],
  ])('%s -> %s', (input, expected) => {
    expect(toHttpsImageUrl(input)).toBe(expected)
  })

  it('is applied to Lidarr/SkyHook-shaped image arrays', () => {
    expect(
      extractImages([
        { coverType: 'poster', remoteUrl: 'http://assets.fanart.tv/p.jpg' },
        { coverType: 'clearlogo', remoteUrl: 'http://assets.fanart.tv/l.png' },
      ]),
    ).toEqual({ url: 'https://assets.fanart.tv/p.jpg', logoUrl: 'https://assets.fanart.tv/l.png' })
  })
})
