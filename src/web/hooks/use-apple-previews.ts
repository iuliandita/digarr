import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errMsg } from '@/core/validation'
import { getCurrentUser, getUserPreferences, updateUserPreferences } from '../lib/api'

type Preferences = Record<string, unknown>

/** The per-user `applePreviews` preference: Apple clips instead of the Spotify player. */
export function useApplePreviews() {
  const client = useQueryClient()
  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const { data } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: getUserPreferences,
    enabled: Boolean(user),
  })
  const { mutate, isPending } = useMutation({
    mutationFn: (enabled: boolean) => updateUserPreferences({ applePreviews: enabled }),
    onMutate: async (enabled) => {
      await client.cancelQueries({ queryKey: ['user-preferences'] })
      const previous = client.getQueryData<Preferences>(['user-preferences'])
      client.setQueryData<Preferences>(['user-preferences'], (old) => ({
        ...old,
        applePreviews: enabled,
      }))
      return { previous }
    },
    onError: (error, _enabled, context) => {
      client.setQueryData(['user-preferences'], context?.previous)
      toast.error(errMsg(error))
    },
  })
  return {
    enabled: data?.applePreviews === true,
    ready: data !== undefined,
    saving: isPending,
    setEnabled: mutate,
  }
}
