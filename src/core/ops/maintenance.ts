let active = false

export function setMaintenance(on: boolean): void {
  active = on
}

export function isMaintenance(): boolean {
  return active
}
