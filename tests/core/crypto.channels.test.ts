// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decryptChannelSecrets,
  encryptChannelSecrets,
  initEncryption,
  maskChannelSecrets,
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

  it('leaves webhook and non-secret fields untouched', () => {
    const channels = sampleChannels()
    const enc = encryptChannelSecrets(channels)

    expect(enc[0]).toEqual(channels[0]) // webhook has no secret field
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

  it('mask replaces every secret with ***', () => {
    const masked = maskChannelSecrets(sampleChannels())
    expect((masked[1] as { botToken: string }).botToken).toBe('***')
    expect((masked[2] as { token?: string }).token).toBe('***')
    expect((masked[3] as { urls: string }).urls).toBe('***')
    // webhook + non-secret fields survive
    expect(masked[0]).toEqual(sampleChannels()[0])
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
