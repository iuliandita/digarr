import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errMsg } from '@/core/validation'
import { ConfirmDialog } from '../components/confirm-dialog'
import { Hint } from '../components/hint'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  createUserApi,
  deleteUserApi,
  getCurrentUser,
  listUsers,
  updateUserAdmin,
} from '../lib/api'
import { useI18n } from '../lib/i18n'

export function UserManagementPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<{
    id: number
    username: string
  } | null>(null)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newIsAdmin, setNewIsAdmin] = useState(false)

  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })

  const adminCount = usersQuery.data?.filter((u) => u.isAdmin).length ?? 0

  const toggleAdmin = useMutation({
    mutationFn: ({ id, isAdmin }: { id: number; isAdmin: boolean }) => updateUserAdmin(id, isAdmin),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (err) => toast.error(errMsg(err)),
  })

  const deleteUser = useMutation({
    mutationFn: (id: number) => deleteUserApi(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (err) => toast.error(errMsg(err)),
  })

  const createUser = useMutation({
    mutationFn: () =>
      createUserApi({ username: newUsername, password: newPassword, isAdmin: newIsAdmin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(`${t('userManagement.userCreated')} "${newUsername}"`)
      setNewUsername('')
      setNewPassword('')
      setNewIsAdmin(false)
      setShowForm(false)
    },
    onError: (err) => {
      const msg = errMsg(err)
      toast.error(msg.includes('409') ? t('userManagement.usernameTaken') : msg)
    },
  })

  if (usersQuery.isLoading) {
    return <div className="p-8 text-muted">{t('userManagement.loading')}</div>
  }

  if (usersQuery.error) {
    return (
      <div className="p-8 text-reject">
        {t('userManagement.failedToLoad')}:{' '}
        {usersQuery.error instanceof Error ? usersQuery.error.message : t('common.unknownError')}
      </div>
    )
  }

  return (
    <div className={embedded ? 'space-y-6' : 'p-6 space-y-6 max-w-6xl mx-auto'}>
      <div className="flex items-center justify-between">
        {embedded ? (
          <h2 className="text-lead font-semibold text-text">{t('userManagement.title')}</h2>
        ) : (
          <h1 className="text-2xl font-bold text-text">{t('userManagement.title')}</h1>
        )}
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus size={14} className="mr-1" />
          {t('userManagement.addUser')}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createUser.mutate()
          }}
          className="bg-surface border border-border rounded-lg p-4 space-y-3"
        >
          <h2 className="text-sm font-semibold text-text">{t('userManagement.createUser')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              type="text"
              placeholder={t('userManagement.usernamePlaceholder')}
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              autoFocus
            />
            <Input
              type="password"
              placeholder={t('userManagement.passwordPlaceholder')}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
            <input
              type="checkbox"
              checked={newIsAdmin}
              onChange={(e) => setNewIsAdmin(e.target.checked)}
              className="rounded border-border"
            />
            {t('userManagement.adminPrivileges')}
          </label>
          <div className="flex gap-2 justify-end">
            <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={createUser.isPending}>
              {createUser.isPending ? t('userManagement.creating') : t('common.create')}
            </Button>
          </div>
        </form>
      )}

      <Hint id="user-management-intro-tip" type="inline">
        {t('userManagement.introTip')}
      </Hint>

      <div className="space-y-2">
        {usersQuery.data?.length === 0 && (
          <p className="text-sm text-muted">{t('userManagement.noUsers')}</p>
        )}
        {usersQuery.data?.map((user) => {
          const isSelf = currentUser?.id === user.id
          const isLastAdmin = user.isAdmin && adminCount <= 1
          return (
            <div
              key={user.id}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface"
            >
              <div>
                <span className="font-medium text-text">{user.username}</span>
                {user.email && <span className="text-sm text-muted ml-2">{user.email}</span>}
                <div className="flex gap-2 mt-1">
                  {user.isAdmin && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                      {t('userManagement.adminBadge')}
                    </span>
                  )}
                  <span className="text-xs px-1.5 py-0.5 rounded bg-bg text-muted border border-border">
                    {user.authProvider}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleAdmin.mutate({ id: user.id, isAdmin: !user.isAdmin })}
                  disabled={
                    toggleAdmin.isPending ||
                    (isSelf && user.isAdmin) ||
                    (isLastAdmin && user.isAdmin)
                  }
                  title={
                    isSelf && user.isAdmin
                      ? t('userManagement.cannotRemoveOwnAdmin')
                      : isLastAdmin && user.isAdmin
                        ? t('userManagement.lastAdminCannotRemove')
                        : undefined
                  }
                >
                  {user.isAdmin ? t('userManagement.removeAdmin') : t('userManagement.makeAdmin')}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmDeleteUser({ id: user.id, username: user.username })}
                  disabled={deleteUser.isPending || isSelf || isLastAdmin}
                  title={
                    isSelf
                      ? t('userManagement.cannotDeleteSelf')
                      : isLastAdmin
                        ? t('userManagement.lastAdminCannotDelete')
                        : undefined
                  }
                >
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      {confirmDeleteUser && (
        <ConfirmDialog
          title={t('userManagement.deleteUser')}
          message={`${t('userManagement.deleteUserPrompt')} "${confirmDeleteUser.username}"? ${t('common.cannotBeUndone')}`}
          confirmLabel={t('common.delete')}
          onConfirm={() => {
            deleteUser.mutate(confirmDeleteUser.id)
            setConfirmDeleteUser(null)
          }}
          onCancel={() => setConfirmDeleteUser(null)}
        />
      )}
    </div>
  )
}
