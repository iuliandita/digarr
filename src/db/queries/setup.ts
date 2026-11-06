import { eq, sql } from 'drizzle-orm'
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

export class SetupAdminRequiredError extends Error {
  constructor() {
    super('Setup requires an admin')
    this.name = 'SetupAdminRequiredError'
  }
}

export async function completeSetupWithServices(
  db: Database,
  config: SetupConfig,
  services: SetupServices = {},
) {
  return db.transaction(async (tx) => {
    // Serialize the anonymous bootstrap decision with user registration and role changes.
    await tx.execute(sql`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`)
    await tx.insert(settings).values({ id: 1, setupComplete: false }).onConflictDoNothing()
    const [current] = await tx
      .select({ setupComplete: settings.setupComplete })
      .from(settings)
      .where(eq(settings.id, 1))
      .for('update')
    if (!current) throw new Error('Setup settings unavailable')
    if (current.setupComplete) throw new SetupAlreadyCompleteError()

    if (services.userId) {
      const [owner] = await tx
        .select({ isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, services.userId))
        .for('update')
      if (!owner) throw new SetupOwnerRequiredError()
      if (!owner.isAdmin) throw new SetupAdminRequiredError()
    } else {
      const [existing] = await tx.select({ id: users.id }).from(users).limit(1)
      if (
        existing ||
        config.lidarrUrl ||
        config.lidarrApiKey ||
        services.emby ||
        !config.aiProvider?.trim()
      ) {
        throw new SetupOwnerRequiredError()
      }
    }

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
