// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { PipelineOrchestrator } from '@/core/pipeline/orchestrator'
import { createPipelineSSEStream } from '@/server/sse'

// SSE frames are `\n\n`-separated. Each frame carries `id: N`, optional
// `data: ...`, or `: keepalive` comment lines. Return the parsed frames and
// whatever trailing bytes didn't terminate a frame yet.
type ParsedFrame = { id?: string; data?: unknown; comment?: string }
function parseFrames(buf: string): { frames: ParsedFrame[]; remainder: string } {
  const frames: ParsedFrame[] = []
  const parts = buf.split('\n\n')
  const remainder = parts.pop() ?? ''
  for (const raw of parts) {
    if (raw === '') continue
    const frame: ParsedFrame = {}
    for (const line of raw.split('\n')) {
      if (line.startsWith(': ')) {
        frame.comment = line.slice(2)
      } else if (line.startsWith('id: ')) {
        frame.id = line.slice(4)
      } else if (line.startsWith('data: ')) {
        frame.data = JSON.parse(line.slice(6))
      } else if (line.startsWith('retry: ')) {
        // retry-advisory opening frame; ignored for event assertions
      }
    }
    frames.push(frame)
  }
  return { frames, remainder }
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<ParsedFrame[]> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const frames: ParsedFrame[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parsed = parseFrames(buf)
    frames.push(...parsed.frames)
    buf = parsed.remainder
  }
  buf += decoder.decode()
  const tail = parseFrames(buf)
  frames.push(...tail.frames)
  return frames
}

function makeOrchestrator(): PipelineOrchestrator {
  const emitter = new EventEmitter()
  return emitter as unknown as PipelineOrchestrator
}

describe('pipeline SSE stream', () => {
  it('emits progress and complete events in order with monotonic ids', async () => {
    const orchestrator = makeOrchestrator()
    const stream = createPipelineSSEStream(orchestrator)

    // Emit a typical run: collect -> analyze -> complete.
    // Emitting synchronously after construction is fine: the ReadableStream's
    // start() runs eagerly and registers listeners before this line.
    setImmediate(() => {
      orchestrator.emit('progress', { stage: 'collect', current: 0, total: 10 })
      orchestrator.emit('progress', { stage: 'analyze', current: 5, total: 10 })
      orchestrator.emit('progress', { stage: 'complete' })
    })

    const frames = await drain(stream)
    const dataFrames = frames.filter((f) => f.data !== undefined)
    expect(dataFrames.length).toBe(3)

    const ids = dataFrames.map((f) => Number.parseInt(f.id ?? '', 10))
    expect(ids).toEqual([1, 2, 3])
    expect(ids.every((n) => Number.isInteger(n) && n > 0)).toBe(true)

    const stages = dataFrames.map((f) => (f.data as { stage?: string } | undefined)?.stage)
    expect(stages).toEqual(['collect', 'analyze', 'complete'])
  })

  it('closes the stream after the final complete frame', async () => {
    const orchestrator = makeOrchestrator()
    const stream = createPipelineSSEStream(orchestrator)
    setImmediate(() => {
      orchestrator.emit('progress', { stage: 'collect' })
      orchestrator.emit('complete')
    })
    const frames = await drain(stream)
    const lastDataFrame = frames.filter((f) => f.data !== undefined).pop()
    expect(lastDataFrame).toBeDefined()
    expect((lastDataFrame?.data as { stage?: string } | undefined)?.stage).toBe('complete')
  })

  it('emits an error frame with message and closes', async () => {
    const orchestrator = makeOrchestrator()
    const stream = createPipelineSSEStream(orchestrator)
    setImmediate(() => {
      orchestrator.emit('error', new Error('boom'))
    })
    const frames = await drain(stream)
    const dataFrames = frames.filter((f) => f.data !== undefined)
    expect(dataFrames).toHaveLength(1)
    const first = dataFrames[0]
    if (!first) throw new Error('missing error frame')
    const payload = first.data as { stage: string; message: string }
    expect(payload.stage).toBe('error')
    expect(payload.message).toBe('boom')
  })

  it('advises retry on the very first frame', async () => {
    const orchestrator = makeOrchestrator()
    const stream = createPipelineSSEStream(orchestrator)
    const reader = stream.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text.startsWith('retry: ')).toBe(true)
    // close the stream cleanly so the test doesn't hang
    setImmediate(() => orchestrator.emit('complete'))
    await drain(
      new ReadableStream<Uint8Array>({
        start(controller) {
          reader
            .read()
            .then(function pump({ value, done }): unknown {
              if (done) {
                controller.close()
                return
              }
              controller.enqueue(value)
              return reader.read().then(pump)
            })
            .catch(() => controller.close())
        },
      }),
    )
  })
})
