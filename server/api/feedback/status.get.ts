import { useDb } from '../../db/client'
import { getFeedbackStatus } from '../../services/feedback/settings'
import { requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  return getFeedbackStatus(useDb())
})
