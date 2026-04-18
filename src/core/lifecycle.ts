let shuttingDown = false

export function markShuttingDown(): void {
  shuttingDown = true
}

export function isShuttingDown(): boolean {
  return shuttingDown
}

// Test-only reset; use with `vi.resetModules()` or `afterEach` cleanup.
export function resetLifecycleForTests(): void {
  shuttingDown = false
}
