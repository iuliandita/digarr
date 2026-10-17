import {
  createListenBrainzPlaylist,
  loveLastFm,
  loveListenBrainz,
} from '@/core/clients/scrobbler-write-back'
import type { JobRecorder } from '@/core/jobs/types'
import { errMsg, isValidMbid, redactSecrets } from '@/core/validation'
import type { OAuthTokenRow } from '@/db/queries/oauth-tokens'
import type { UserConnections } from '@/db/queries/users'
import { mergePreferences, type Preferences } from '@/db/schema'

export type FeedbackTrack = {
  artistName: string
  trackName: string
  recordingMbid?: string
}

type WriteBackDeps = {
  getPreferences: (userId: number) => Promise<Partial<Preferences> | null | undefined>
  getConnections: (userId: number) => Promise<UserConnections | null>
  getLastFmSession: (userId: number) => Promise<OAuthTokenRow | null>
  recorder: JobRecorder
  lastfmSharedSecret: () => string | undefined
  encryptionEnabled: () => boolean
}

export type PlaylistGenerationTrigger = 'manual' | 'scheduled'

type Operation = 'love' | 'playlist'
type Service = 'listenbrainz' | 'lastfm'

export function createScrobblerWriteBack(deps: WriteBackDeps) {
  async function send(
    userId: number,
    service: Service,
    operation: Operation,
    dispatch: (connections: UserConnections, session: OAuthTokenRow | null) => Promise<void>,
  ): Promise<void> {
    let jobId: number | undefined
    let credentialsLoaded = false
    const secrets: Array<string | null | undefined> = []
    const preference =
      service === 'lastfm'
        ? 'lastfmLoveEnabled'
        : operation === 'playlist'
          ? 'listenbrainzPlaylistEnabled'
          : 'listenbrainzLoveEnabled'
    try {
      if (mergePreferences(await deps.getPreferences(userId))[preference] !== true) return
      jobId = await deps.recorder.start({
        type: 'target',
        userId,
        metadata: { writeBackService: service, operation },
      })
      const connections = await deps.getConnections(userId)
      const session = service === 'lastfm' ? await deps.getLastFmSession(userId) : null
      secrets.push(
        connections?.listenbrainzToken,
        connections?.lastfmApiKey,
        session?.accessToken,
        session?.clientId,
        session?.clientSecret,
        deps.lastfmSharedSecret(),
      )
      // A toggle changed while credentials were loading must win over this work.
      if (mergePreferences(await deps.getPreferences(userId))[preference] !== true) {
        await deps.recorder.cancel(jobId)
        return
      }
      if (!connections) throw new Error('Service connection is missing')
      credentialsLoaded = true
      await dispatch(connections, session)
      await deps.recorder.complete(jobId)
    } catch (error) {
      const message = !credentialsLoaded
        ? 'Could not prepare scrobbler write-back'
        : redactSecrets(errMsg(error), secrets).slice(0, 300)
      console.error(`[write-back:${service}] ${message}`)
      if (jobId !== undefined) {
        try {
          await deps.recorder.fail(jobId, message)
        } catch {
          console.error(`[write-back:${service}] Could not record delivery failure`)
        }
      }
    }
  }

  async function approvedTrack(userId: number, track: FeedbackTrack): Promise<void> {
    if (!track.artistName.trim() || !track.trackName.trim()) return
    const sends: Promise<void>[] = []
    if (isValidMbid(track.recordingMbid)) {
      const recordingMbid = track.recordingMbid
      sends.push(
        send(userId, 'listenbrainz', 'love', async (connections) => {
          if (!connections.listenbrainzToken) throw new Error('ListenBrainz token is missing')
          await loveListenBrainz(connections.listenbrainzToken, recordingMbid)
        }),
      )
    }
    sends.push(
      send(userId, 'lastfm', 'love', async (_connections, session) => {
        const sharedSecret = deps.lastfmSharedSecret()
        if (!sharedSecret || !deps.encryptionEnabled()) {
          throw new Error('Last.fm write-back is not configured')
        }
        if (
          !session?.accessToken ||
          !session.clientId ||
          session.clientSecret !== sharedSecret ||
          session.clientId !== _connections.lastfmApiKey ||
          session.accessToken.startsWith('enc:')
        ) {
          throw new Error('Reconnect Last.fm in Account settings')
        }
        await loveLastFm({
          apiKey: session.clientId,
          sharedSecret,
          sessionKey: session.accessToken,
          artistName: track.artistName,
          trackName: track.trackName,
        })
      }),
    )
    await Promise.all(sends)
  }

  async function generatedPlaylist(
    userId: number,
    title: string,
    tracks: Array<{ artistName: string; trackName: string; mbid?: string }>,
    trigger: PlaylistGenerationTrigger,
  ): Promise<void> {
    if (trigger !== 'manual') return
    await send(userId, 'listenbrainz', 'playlist', async (connections) => {
      if (!connections.listenbrainzToken) throw new Error('ListenBrainz token is missing')
      await createListenBrainzPlaylist(connections.listenbrainzToken, title, tracks)
    })
  }

  return { approvedTrack, generatedPlaylist }
}

export type ScrobblerWriteBack = ReturnType<typeof createScrobblerWriteBack>
