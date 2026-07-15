import PQueue from 'p-queue'

export const MEDIA_SERVER_QUEUE_OPTIONS = {
  concurrency: 3,
  interval: 1000,
  intervalCap: 10,
} as const

export function createMediaServerQueue(): PQueue {
  return new PQueue(MEDIA_SERVER_QUEUE_OPTIONS)
}
