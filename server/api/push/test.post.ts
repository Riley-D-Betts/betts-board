import { useDb } from '../../db/client'
import { sendToHousehold } from '../../services/push/send'
import { requireAdmin, requireHousehold } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireAdmin(event)
  const hh = requireHousehold()

  return sendToHousehold(useDb(), {
    householdId: hh.id,
    profileId: profile.id,
    payload: {
      title: 'Test notification',
      body: 'Push notifications are working on this device.',
      url: '/',
    },
  })
})
