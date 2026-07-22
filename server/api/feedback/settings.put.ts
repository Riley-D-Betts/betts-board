import { feedbackSettingsSchema } from '#shared/schemas/feedback'
import { useDb } from '../../db/client'
import { updateFeedbackSettings } from '../../services/feedback/settings'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const input = await readValidatedBody(event, feedbackSettingsSchema.parse)
  return updateFeedbackSettings(useDb(), input)
})
