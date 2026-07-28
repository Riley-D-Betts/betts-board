import webpush from 'web-push'
import { and, eq } from 'drizzle-orm'
import { zHttpUrl } from '#shared/schemas/common'
import type { Db } from '../../db/client'
import { pushSubscriptions } from '../../db/schema'
import { getVapidKeys } from './vapid'

export interface PushPayload {
  title: string
  body?: string
  url?: string
}

export type SubscriptionRow = typeof pushSubscriptions.$inferSelect

const MAX_FAILURES = 5

/** Deliver one payload to one subscription. Never throws: gone endpoints
 * (404/410) are pruned immediately, other failures increment failCount and
 * prune at >= 5. Returns true when the push service accepted the message. */
export async function sendToSubscription(db: Db, sub: SubscriptionRow, payload: PushPayload): Promise<boolean> {
  const keys = getVapidKeys(db)
  if (!keys) return false

  // The endpoint is checked again on the way OUT, not only on the way in.
  //
  // `pushSubscribeSchema` pins the scheme now, but rows registered before it
  // did still hold whatever `z.string().url()` accepted, and this is where
  // they are used: web-push does not vet the scheme itself — hand it
  // `gopher://127.0.0.1:11211/_x` and it opens a connection to that host and
  // port. A subscription is re-used on every notification, so one bad row
  // fires from inside the container forever. Every real push service
  // (RFC 8030) is https, so this can only ever skip a hostile row.
  if (!zHttpUrl.safeParse(sub.endpoint).success) {
    console.warn('[push] skipping subscription with a non-http(s) endpoint')
    return false
  }

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: 'mailto:admin@betts.board',
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
      },
    )
    if (sub.failCount > 0) {
      db.update(pushSubscriptions).set({ failCount: 0 }).where(eq(pushSubscriptions.id, sub.id)).run()
    }
    return true
  }
  catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode
    if (statusCode === 404 || statusCode === 410) {
      // Subscription is gone at the push service — prune it.
      db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run()
    }
    else {
      const failCount = sub.failCount + 1
      if (failCount >= MAX_FAILURES) {
        db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run()
      }
      else {
        db.update(pushSubscriptions).set({ failCount }).where(eq(pushSubscriptions.id, sub.id)).run()
      }
    }
    console.error(`[push] send failed (${statusCode ?? 'unknown'}):`, (err as Error).message)
    return false
  }
}

export interface SendToHouseholdArgs {
  householdId: string
  /** When set, only this profile's subscriptions are targeted. */
  profileId?: string
  payload: PushPayload
}

/** Fan a payload out to every subscription in the household (or one profile's). */
export async function sendToHousehold(db: Db, args: SendToHouseholdArgs): Promise<{ sent: number, total: number }> {
  const subs = db.select().from(pushSubscriptions).where(and(
    eq(pushSubscriptions.householdId, args.householdId),
    ...(args.profileId ? [eq(pushSubscriptions.profileId, args.profileId)] : []),
  )).all()

  let sent = 0
  for (const sub of subs) {
    if (await sendToSubscription(db, sub, args.payload)) sent++
  }
  return { sent, total: subs.length }
}
