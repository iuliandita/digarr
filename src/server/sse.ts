import type { PipelineOrchestrator } from '@/core/pipeline/orchestrator'

export function createPipelineSSEStream(orchestrator: PipelineOrchestrator): ReadableStream {
  let progressHandler: ((progress: unknown) => void) | null = null
  let completeHandler: (() => void) | null = null
  let errorHandler: ((err: unknown) => void) | null = null

  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      progressHandler = (progress: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`))
          // Close stream when pipeline signals completion via progress event
          if (
            progress !== null &&
            typeof progress === 'object' &&
            (progress as Record<string, unknown>).stage === 'complete'
          ) {
            controller.close()
          }
        } catch {
          // Controller may be closed already
        }
      }

      completeHandler = () => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ stage: 'complete' })}\n\n`))
          controller.close()
        } catch {
          // Already closed
        }
      }

      errorHandler = (err: unknown) => {
        try {
          const message = err instanceof Error ? err.message : String(err)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ stage: 'error', message })}\n\n`),
          )
          controller.close()
        } catch {
          // Already closed
        }
      }

      orchestrator.on('progress', progressHandler)
      orchestrator.once('complete', completeHandler)
      orchestrator.once('error', errorHandler)
    },

    cancel() {
      if (progressHandler) orchestrator.off('progress', progressHandler)
      if (completeHandler) orchestrator.off('complete', completeHandler)
      if (errorHandler) orchestrator.off('error', errorHandler)
    },
  })
}
