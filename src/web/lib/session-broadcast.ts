/**
 * Cross-tab session signal. The auth cookie is shared by every tab, so a
 * logout or account switch in one tab leaves the others showing the previous
 * account's cached data until a 401 or a refocus. Writing to localStorage
 * fires a `storage` event in the other tabs, where the listener re-checks auth
 * and drops the query cache.
 */
export const SESSION_CHANGED_STORAGE_KEY = 'digarr-session-changed'

export function broadcastSessionChanged() {
  try {
    localStorage.setItem(SESSION_CHANGED_STORAGE_KEY, String(Date.now()))
  } catch {
    // Storage unavailable; the same-tab flow still works.
  }
}

export function subscribeSessionChanged(onChange: () => void): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key === SESSION_CHANGED_STORAGE_KEY) onChange()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
