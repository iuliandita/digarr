import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errMsg } from '@/core/validation'
import { getUserPreferences, updateUserPreferences } from '../lib/api'

type Preferences = Record<string, unknown>

/**
 * The per-user `appleAutoloadDashboard` preference: Today's Pick loads the
 * inline Apple Music player without a click. Kept apart from the Spotify
 * autoload preference, so consenting to one player never loads the other.
 */
export function useAppleAutoload() {
  const client = useQueryClient()
  const { data } = useQuery({ queryKey: ['user-preferences'], queryFn: getUserPreferences })
  const { mutate } = useMutation({
    mutationFn: (enabled: boolean) => updateUserPreferences({ appleAutoloadDashboard: enabled }),
    onMutate: async (enabled) => {
      await client.cancelQueries({ queryKey: ['user-preferences'] })
      const previous = client.getQueryData<Preferences>(['user-preferences'])
      client.setQueryData<Preferences>(['user-preferences'], (old) => ({
        ...old,
        appleAutoloadDashboard: enabled,
      }))
      return { previous }
    },
    onError: (error, _enabled, context) => {
      client.setQueryData(['user-preferences'], context?.previous)
      toast.error(errMsg(error))
    },
  })
  return { enabled: data?.appleAutoloadDashboard === true, setEnabled: mutate }
}
