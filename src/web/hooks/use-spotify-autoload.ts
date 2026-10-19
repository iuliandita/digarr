import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errMsg } from '@/core/validation'
import { getUserPreferences, updateUserPreferences } from '../lib/api'

type Preferences = Record<string, unknown>

export function useSpotifyAutoload() {
  const client = useQueryClient()
  const { data } = useQuery({ queryKey: ['user-preferences'], queryFn: getUserPreferences })
  const { mutate } = useMutation({
    mutationFn: (enabled: boolean) => updateUserPreferences({ spotifyAutoloadDashboard: enabled }),
    onMutate: async (enabled) => {
      await client.cancelQueries({ queryKey: ['user-preferences'] })
      const previous = client.getQueryData<Preferences>(['user-preferences'])
      client.setQueryData<Preferences>(['user-preferences'], (old) => ({
        ...old,
        spotifyAutoloadDashboard: enabled,
      }))
      return { previous }
    },
    onError: (error, _enabled, context) => {
      client.setQueryData(['user-preferences'], context?.previous)
      toast.error(errMsg(error))
    },
  })
  return { enabled: data?.spotifyAutoloadDashboard === true, setEnabled: mutate }
}
