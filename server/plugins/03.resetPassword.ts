import { eq } from 'drizzle-orm'
import { useDb } from '../db/client'
import { households } from '../db/schema'

// BETTS_RESET_PASSWORD=1 (set for one boot, then removed) clears the household
// password hash; the unlock screen then offers "choose a new password". Only
// someone with access to the server's env can trigger this.
export default defineNitroPlugin(() => {
  if (process.env.BETTS_RESET_PASSWORD !== '1') return
  const hh = useDb().select().from(households).limit(1).get()
  if (!hh) return
  useDb().update(households).set({ passwordHash: '' }).where(eq(households.id, hh.id)).run()
  console.warn('[betts-board] household password cleared (BETTS_RESET_PASSWORD=1) — set a new one at the unlock screen')
})
