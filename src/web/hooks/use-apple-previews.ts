import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errMsg } from '@/core/validation'
import { getCurrentUser, getUserPreferences, updateUserPreferences } from '../lib/api'

type Preferences = Record<string, unknown>

/**
 * The `applePreviews` preference as consumers see it. 'unknown' covers both
 * "still loading" and "could not be loaded": either way the Spotify player
 * must not be used, because the user may have opted out of it.
 */
export type ApplePreviewsPreference = 'on' | 'off' | 'unknown'

/** The per-user `applePreviews` preference: Apple clips instead of the Spotify player. */
export function useApplePreviews() {
  const client = useQueryClient()
  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const { data, isError } = useQuery({
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
  const preference: ApplePreviewsPreference =
    data === undefined ? 'unknown' : data.applePreviews === true ? 'on' : 'off'
  return {
    preference,
    /**
     * True while the preference may still arrive. False once it is known, once
     * loading it failed, and when there is no signed-in user to load it for
     * (getCurrentUser resolves null for any failure, so that case stays
     * 'unknown' rather than defaulting to the Spotify player).
     */
    pending: data === undefined && !isError && user !== null,
    enabled: preference === 'on',
    ready: data !== undefined,
    saving: isPending,
    setEnabled: mutate,
  }
}
