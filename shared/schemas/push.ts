import { z } from 'zod'
import { zHttpUrl } from './common'

/**
 * The push endpoint is a URL the SERVER posts to, on a schedule, from inside
 * the container — so it is an SSRF primitive, not just a string we store.
 * `z.string().url()` accepted `file:///…` and `gopher://127.0.0.1:11211/`.
 *
 * Restricting it to http(s) cannot break a real subscription: RFC 8030 defines
 * push endpoints as HTTP resources, and every browser push service in the wild
 * (FCM, Mozilla autopush, Windows WNS, Apple) hands the client an `https:` URL
 * from `PushSubscription.endpoint`. `http:` is left allowed only so a
 * self-hosted push relay on the family's own LAN still works.
 */
const zPushEndpoint = zHttpUrl.max(2000)

export const pushSubscribeSchema = z.object({
  endpoint: zPushEndpoint,
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
})

export const pushUnsubscribeSchema = z.object({
  endpoint: zPushEndpoint,
})
