import { lockFinance } from '../../services/finance/access'
import { requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  // A key holds no finance session of its own; letting it call this would only
  // ever be a way to lock somebody else out.
  if (event.context.boardApiSession) {
    throw createError({ statusCode: 403, statusMessage: 'Finance is not available to API keys' })
  }
  await requireUnlocked(event)
  await lockFinance(event)
  return { ok: true }
})
