import * as z from 'zod'
import { notificationChannel } from './settings'

export const userNotificationChannelsSchema = z.strictObject({
  channels: z
    .array(notificationChannel)
    .max(20)
    .refine(
      (channels) => new Set(channels.map((channel) => channel.id)).size === channels.length,
      'Notification channel IDs must be unique',
    )
    .refine(
      (channels) =>
        channels.every(
          (channel) =>
            channel.events.every((event) => event === 'request_resolved') &&
            channel.allowPrivateTarget !== true,
        ),
      'Personal channels only support request outcomes and public targets',
    ),
})
