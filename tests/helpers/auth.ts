export function authHeaders(token = 'test-token-1') {
  return { Authorization: `Bearer ${token}` }
}
