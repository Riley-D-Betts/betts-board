import { useDb } from '../db/client'
import { households } from '../db/schema'
import { getVapidKeys } from '../services/push/vapid'

// Runs after 01.migrate (name order). Warm up household VAPID keys so the
// first subscriber never races key generation. getVapidKeys is also called
// lazily by the push routes, so a fresh install (no household row yet) simply
// gets its keys on first use after setup.
export default defineNitroPlugin(() => {
  const db = useDb()
  const hh = db.select().from(households).limit(1).get()
  if (!hh) return
  const hadKeys = !!hh.vapidPublicKey
  getVapidKeys(db)
  if (!hadKeys) console.log('[betts-board] generated VAPID keys')
})
