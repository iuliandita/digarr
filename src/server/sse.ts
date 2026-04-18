import type { PipelineOrchestrator } from '@/core/pipeline/orchestrator'
import { errMsg } from '@/core/validation'

const HEARTBEAT_MS = 20_000
const RECONNECT_MS = 5_000

export function createPipelineSSEStream(orchestrator: PipelineOrchestrator): ReadableStream {
  let progressHandler: ((progress: unknown) => void) | null = null
  let completeHandler: (() => void) | null = null
  let errorHandler: ((err: unknown) => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let eventSeq = 0

  function cleanup() {
    if (progressHandler) orchestrator.off('progress', progressHandler)
    if (completeHandler) orchestrator.off('complete', completeHandler)
    if (errorHandler) orchestrator.off('error', errorHandler)
    if (heartbeat) clearInterval(heartbeat)
    progressHandler = null
    completeHandler = null
    errorHandler = null
    heartbeat = null
  }

  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      // Advise the client to retry after RECONNECT_MS on disconnect. Each
      // event also carries an incrementing `id:` so clients can send
      // Last-Event-ID on reconnect (we do not replay pipeline progress for
      // now since runs are short and deterministic - the retry primarily
      // smooths transient network blips).
      controller.enqueue(encoder.encode(`retry: ${RECONNECT_MS}\n\n`))

      function emit(event: Record<string, unknown>) {
        const id = ++eventSeq
        controller.enqueue(encoder.encode(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`))
      }

      progressHandler = (progress: unknown) => {
        try {
          emit((progress ?? {}) as Record<string, unknown>)
          if (
            progress !== null &&
            typeof progress === 'object' &&
            (progress as Record<string, unknown>).stage === 'complete'
          ) {
            cleanup()
            controller.close()
          }
        } catch {
          cleanup()
        }
      }

      completeHandler = () => {
        try {
          emit({ stage: 'complete' })
          cleanup()
          controller.close()
        } catch {
          cleanup()
        }
      }

      errorHandler = (err: unknown) => {
        try {
          emit({ stage: 'error', message: errMsg(err) })
          cleanup()
          controller.close()
        } catch {
          cleanup()
        }
      }

      // Keep-alive comments prevent intermediate proxies from tearing down
      // idle connections. SSE spec defines `:` prefix as a comment line.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          cleanup()
        }
      }, HEARTBEAT_MS)
      heartbeat.unref?.()

      orchestrator.on('progress', progressHandler)
      orchestrator.once('complete', completeHandler)
      orchestrator.once('error', errorHandler)
    },

    cancel() {
      cleanup()
    },
  })
}
