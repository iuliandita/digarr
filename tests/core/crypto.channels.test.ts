// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decryptChannelSecrets,
  encryptChannelSecrets,
  initEncryption,
  maskChannelSecrets,
  maskWebhookUrl,
  restoreMaskedChannelSecrets,
} from '@/core/crypto'
import type { NotificationChannel } from '@/core/notifications/types'

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function sampleChannels(): NotificationChannel[] {
  return [
    {
      id: 'w',
      type: 'webhook',
      enabled: true,
      events: ['batch_complete'],
      url: 'https://x.test/hook',
    },
    {
      id: 't',
      type: 'telegram',
      enabled: true,
      events: ['batch_complete'],
      botToken: 'bot-secret-123',
      chatId: '999',
    },
    {
      id: 'n',
      type: 'ntfy',
      enabled: true,
      events: ['digest'],
      server: 'https://ntfy.test',
      topic: 'alerts',
      token: 'ntfy-secret-456',
    },
    {
      id: 'a',
      type: 'apprise',
      enabled: true,
      events: ['digest'],
      endpoint: 'https://apprise.test/notify',
      urls: 'discord://token@id',
    },
  ]
}

describe('channel secret walkers', () => {
  beforeEach(() => {
    initEncryption(TEST_KEY)
  })
  afterEach(() => {
    initEncryption(undefined)
  })

  it('encrypt then decrypt round-trips every secret type', () => {
    const channels = sampleChannels()
    const enc = encryptChannelSecrets(channels)

    const telEnc = enc[1] as Extract<NotificationChannel, { type: 'telegram' }>
    const ntfyEnc = enc[2] as Extract<NotificationChannel, { type: 'ntfy' }>
    const apprEnc = enc[3] as Extract<NotificationChannel, { type: 'apprise' }>
    expect(telEnc.botToken).not.toBe('bot-secret-123')
    expect(telEnc.botToken.startsWith('enc:v1:')).toBe(true)
    expect(ntfyEnc.token?.startsWith('enc:v1:')).toBe(true)
    expect(apprEnc.urls.startsWith('enc:v1:')).toBe(true)

    const dec = decryptChannelSecrets(enc)
    expect(dec).toEqual(channels)
  })

  it('encrypts the webhook url at rest and round-trips it', () => {
    const channels = sampleChannels()
    const enc = encryptChannelSecrets(channels)

    const webhookEnc = enc[0] as Extract<NotificationChannel, { type: 'webhook' }>
    expect(webhookEnc.url).not.toBe('https://x.test/hook')
    expect(webhookEnc.url.startsWith('enc:v1:')).toBe(true)

    const dec = decryptChannelSecrets(enc)
    expect((dec[0] as Extract<NotificationChannel, { type: 'webhook' }>).url).toBe(
      'https://x.test/hook',
    )
  })

  it('leaves non-secret fields untouched', () => {
    const channels = sampleChannels()
    const enc = encryptChannelSecrets(channels)

    const telEnc = enc[1] as Extract<NotificationChannel, { type: 'telegram' }>
    expect(telEnc.chatId).toBe('999') // non-secret field preserved
    const ntfyEnc = enc[2] as Extract<NotificationChannel, { type: 'ntfy' }>
    expect(ntfyEnc.server).toBe('https://ntfy.test')
    expect(ntfyEnc.topic).toBe('alerts')
  })

  it('does not mutate the input channels', () => {
    const channels = sampleChannels()
    encryptChannelSecrets(channels)
    expect((channels[1] as { botToken: string }).botToken).toBe('bot-secret-123')
  })

  it('mask replaces every full secret with *** and partial-masks the webhook url', () => {
    const masked = maskChannelSecrets(sampleChannels())
    expect((masked[1] as { botToken: string }).botToken).toBe('***')
    expect((masked[2] as { token?: string }).token).toBe('***')
    expect((masked[3] as { urls: string }).urls).toBe('***')
    // webhook url keeps its host but hides the secret tail
    expect((masked[0] as { url: string }).url).toBe('https://x.test/***')
    // non-secret fields survive
    expect((masked[1] as { chatId: string }).chatId).toBe('999')
  })

  it('encrypt is a passthrough when encryption is disabled', () => {
    initEncryption(undefined)
    const channels = sampleChannels()
    const enc = encryptChannelSecrets(channels)
    expect(enc).toBe(channels)
    expect((enc[1] as { botToken: string }).botToken).toBe('bot-secret-123')
  })
})

describe('maskWebhookUrl', () => {
  it('masks the token tail of a Discord webhook but keeps the id', () => {
    expect(maskWebhookUrl('https://discord.com/api/webhooks/123456/tok-abc')).toBe(
      'https://discord.com/api/webhooks/123456/***',
    )
  })

  it('masks the last path segment of a Slack webhook', () => {
    expect(maskWebhookUrl('https://hooks.slack.com/services/T00/B00/XXXXsecret')).toBe(
      'https://hooks.slack.com/services/T00/B00/***',
    )
  })

  it('redacts query-string secrets (and the path tail, conservatively)', () => {
    expect(maskWebhookUrl('https://ex.test/hook?token=abc123')).toBe(
      'https://ex.test/***?token=***',
    )
  })

  it('fully masks an unparseable value', () => {
    expect(maskWebhookUrl('not a url')).toBe('***')
  })
})

describe('restoreMaskedChannelSecrets', () => {
  function tel(botToken: string): NotificationChannel {
    return {
      id: 't',
      type: 'telegram',
      enabled: true,
      events: ['batch_complete'],
      botToken,
      chatId: '9',
    }
  }

  it("restores '***' from a matching stored channel", () => {
    const prev = new Map<string, NotificationChannel>([['t', tel('stored-token')]])
    const [out] = restoreMaskedChannelSecrets([tel('***')], prev)
    expect((out as { botToken: string }).botToken).toBe('stored-token')
  })

  it("drops a '***' field when no previous channel exists (new channel)", () => {
    const [out] = restoreMaskedChannelSecrets([tel('***')], new Map())
    expect('botToken' in (out as object)).toBe(false)
  })

  it("drops a '***' field when the previous channel has a different type", () => {
    const prev = new Map<string, NotificationChannel>([
      [
        't',
        {
          id: 't',
          type: 'ntfy',
          enabled: true,
          events: ['digest'],
          server: 'https://n.test',
          topic: 'x',
          token: 'ntfy-tok',
        },
      ],
    ])
    const [out] = restoreMaskedChannelSecrets([tel('***')], prev)
    expect('botToken' in (out as object)).toBe(false)
  })

  it('passes through non-masked secrets and does not mutate input', () => {
    const input = [tel('fresh-plaintext')]
    const prev = new Map<string, NotificationChannel>([['t', tel('stored-token')]])
    const [out] = restoreMaskedChannelSecrets(input, prev)
    expect((out as { botToken: string }).botToken).toBe('fresh-plaintext')
    expect((input[0] as { botToken: string }).botToken).toBe('fresh-plaintext')
    expect(out).not.toBe(input[0])
  })
})

describe('restoreMaskedChannelSecrets webhook url', () => {
  beforeEach(() => {
    initEncryption(TEST_KEY)
  })
  afterEach(() => {
    initEncryption(undefined)
  })

  function webhook(url: string): NotificationChannel {
    return { id: 'w', type: 'webhook', enabled: true, events: ['batch_complete'], url }
  }

  it('keeps the stored url when the submitted url is still masked', () => {
    const storedPlain = 'https://discord.com/api/webhooks/123456/tok-abc'
    const storedEnc = encryptChannelSecrets([webhook(storedPlain)])[0] as NotificationChannel
    const prev = new Map<string, NotificationChannel>([['w', storedEnc]])

    // the client echoes back exactly what the masked GET /settings returned
    const [out] = restoreMaskedChannelSecrets([webhook(maskWebhookUrl(storedPlain))], prev)

    expect((out as { url: string }).url).toBe((storedEnc as { url: string }).url)
    expect((decryptChannelSecrets([out as NotificationChannel])[0] as { url: string }).url).toBe(
      storedPlain,
    )
  })

  it('replaces the url when the user submits a new one', () => {
    const storedPlain = 'https://discord.com/api/webhooks/123456/tok-abc'
    const storedEnc = encryptChannelSecrets([webhook(storedPlain)])[0] as NotificationChannel
    const prev = new Map<string, NotificationChannel>([['w', storedEnc]])

    const [out] = restoreMaskedChannelSecrets([webhook('https://new.test/hook')], prev)

    expect((out as { url: string }).url).toBe('https://new.test/hook')
  })
})
