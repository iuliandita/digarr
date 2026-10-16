import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { getUserPreferences, updateUserPreferences } from '@/web/lib/api'

export function useHints() {
  const queryClient = useQueryClient()

  const { data: prefs, isSuccess } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: getUserPreferences,
    staleTime: 60_000,
  })

  const dismissedHints: string[] = (prefs?.dismissedHints as string[] | undefined) ?? []

  const isHintDismissed = useCallback(
    (id: string) => !isSuccess || dismissedHints.includes(id),
    [dismissedHints, isSuccess],
  )

  const dismissHint = useCallback(
    async (id: string) => {
      if (dismissedHints.includes(id)) return
      const updated = [...dismissedHints, id]
      queryClient.setQueryData(
        ['user-preferences'],
        (old: Record<string, unknown> | undefined) => ({
          ...(old ?? {}),
          dismissedHints: updated,
        }),
      )
      try {
        await updateUserPreferences({ dismissedHints: updated })
      } catch {
        // best-effort
      }
    },
    [dismissedHints, queryClient],
  )

  const resetHints = useCallback(async () => {
    const previous = dismissedHints
    queryClient.setQueryData(['user-preferences'], (old: Record<string, unknown> | undefined) => ({
      ...(old ?? {}),
      dismissedHints: [],
    }))
    try {
      await updateUserPreferences({ dismissedHints: [] })
    } catch (error) {
      queryClient.setQueryData(
        ['user-preferences'],
        (old: Record<string, unknown> | undefined) => ({
          ...(old ?? {}),
          dismissedHints: previous,
        }),
      )
      throw error
    }
  }, [dismissedHints, queryClient])

  return {
    isHintDismissed,
    dismissHint,
    resetHints,
    dismissedCount: dismissedHints.length,
    loaded: isSuccess,
  }
}
