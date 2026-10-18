import { Navigate, useLocation } from 'react-router-dom'

export function DiscoveryModesRedirect() {
  const { search, hash, state } = useLocation()
  return <Navigate to={`/discovery-modes${search}${hash}`} state={state} replace />
}
