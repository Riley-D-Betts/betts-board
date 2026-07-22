import { eq } from 'drizzle-orm'
import { pushUnsubscribeSchema } from '#shared/schemas/push'
import { useDb } from '../../db/client'
import { pushSubscriptions } from '../../db/schema'
import { requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const input = await readValidatedBody(event, pushUnsubscribeSchema.parse)
  useDb().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, input.endpoint)).run()
  return { ok: true }
})
