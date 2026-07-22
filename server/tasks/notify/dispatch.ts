import { useDb } from '../../db/client'
import { households } from '../../db/schema'
import { dispatchDueNotifications } from '../../services/push/dispatch'

// Runs every minute (nitro scheduledTasks). Idempotent: the notification_log
// unique index guarantees each (kind, ref, occurrence, subscription) fires once.
export default defineTask({
  meta: {
    name: 'notify:dispatch',
    description: 'Send due event reminders and chore due-soon push notifications',
  },
  async run() {
    try {
      const db = useDb()
      const hh = db.select().from(households).limit(1).get()
      if (!hh) return { result: 'no-household' }
      await dispatchDueNotifications(db, {
        householdId: hh.id,
        timezone: hh.timezone,
        now: Date.now(),
      })
      return { result: 'ok' }
    }
    catch (err) {
      // Never throw — a bad minute must not kill the scheduler.
      console.error('[push] notify:dispatch failed:', err)
      return { result: 'error' }
    }
  },
})
