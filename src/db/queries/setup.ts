import { eq } from 'drizzle-orm'
import type { Database } from '@/db'
import { settings, users } from '@/db/schema'
import { completeSetup, type SetupConfig } from './settings'
import { createTarget } from './targets'
import { updateUserConnections } from './users'

export type SetupServices = {
  userId?: number
  emby?: { url: string; apiKey: string; userId: string }
}

export class SetupOwnerRequiredError extends Error {
  constructor() {
    super('Setup requires an existing owner')
    this.name = 'SetupOwnerRequiredError'
  }
}

export class SetupAlreadyCompleteError extends Error {
  constructor() {
    super('Setup already complete')
    this.name = 'SetupAlreadyCompleteError'
  }
}

export async function completeSetupWithServices(
  db: Database,
  config: SetupConfig,
  services: SetupServices = {},
) {
  return db.transaction(async (tx) => {
    const needsOwner = Boolean(config.lidarrUrl || config.lidarrApiKey || services.emby)
    if (needsOwner) {
      if (!services.userId) throw new SetupOwnerRequiredError()
      const [owner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, services.userId))
        .for('update')
      if (!owner) throw new SetupOwnerRequiredError()
    }

    await tx.insert(settings).values({ id: 1, setupComplete: false }).onConflictDoNothing()
    const [current] = await tx
      .select({ setupComplete: settings.setupComplete })
      .from(settings)
      .where(eq(settings.id, 1))
      .for('update')
    if (!current) throw new Error('Setup settings unavailable')
    if (current.setupComplete) throw new SetupAlreadyCompleteError()

    if (config.lidarrUrl && config.lidarrApiKey) {
      await createTarget(tx, {
        type: 'lidarr',
        name: 'Lidarr',
        // References the server connection saved by completeSetup below.
        config: { useServerConnection: true },
        userId: services.userId,
      })
    }
    if (services.emby) {
      await updateUserConnections(tx, services.userId as number, {
        embyUrl: services.emby.url,
        embyApiKey: services.emby.apiKey,
        embyUserId: services.emby.userId,
      })
      await createTarget(tx, {
        type: 'emby-playlist',
        name: 'Emby',
        config: { ...services.emby, skipTlsVerify: config.skipTlsVerify ?? false },
        userId: services.userId,
      })
    }
    return completeSetup(tx, config)
  })
}
