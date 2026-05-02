export function timeoutSecondsToMs(timeoutSeconds: number): number {
  return Math.max(1, timeoutSeconds) * 1000
}

export function optionalTimeoutSecondsToMs(timeoutSeconds?: number | null): number | undefined {
  return timeoutSeconds == null ? undefined : timeoutSecondsToMs(timeoutSeconds)
}

export function timeoutSecondsWithDefaultToMs(
  timeoutSeconds: number | null | undefined,
  defaultSeconds: number,
): number {
  return timeoutSecondsToMs(timeoutSeconds ?? defaultSeconds)
}
