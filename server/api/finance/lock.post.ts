import { lockFinance } from '../../services/finance/access'
import { requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  await lockFinance(event)
  return { ok: true }
})
