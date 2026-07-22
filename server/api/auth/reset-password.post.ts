import { hash } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../db/client'
import { households } from '../../db/schema'
import { requireHousehold, setBoardSession } from '../../utils/session'

const schema = z.object({ password: z.string().min(6).max(200) })

// Only usable while the hash is cleared (BETTS_RESET_PASSWORD boot).
export default defineEventHandler(async (event) => {
  const household = requireHousehold()
  if (household.passwordHash !== '') {
    throw createError({ statusCode: 403, statusMessage: 'Password reset not armed' })
  }
  const { password } = await readValidatedBody(event, schema.parse)
  useDb().update(households)
    .set({ passwordHash: await hash(password) })
    .where(eq(households.id, household.id))
    .run()
  await setBoardSession(event, { unlocked: true, householdId: household.id })
  return { ok: true }
})
