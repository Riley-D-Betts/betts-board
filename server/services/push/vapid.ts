import webpush from 'web-push'
import { eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { households } from '../../db/schema'

export interface VapidKeys {
  publicKey: string
  privateKey: string
}

/** Household VAPID key pair, lazily generated + persisted on first use.
 * Returns null only before first-boot setup (no household row yet). */
export function getVapidKeys(db: Db): VapidKeys | null {
  const hh = db.select().from(households).limit(1).get()
  if (!hh) return null
  if (hh.vapidPublicKey && hh.vapidPrivateKey) {
    return { publicKey: hh.vapidPublicKey, privateKey: hh.vapidPrivateKey }
  }
  const keys = webpush.generateVAPIDKeys()
  db.update(households)
    .set({ vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey })
    .where(eq(households.id, hh.id))
    .run()
  return keys
}
