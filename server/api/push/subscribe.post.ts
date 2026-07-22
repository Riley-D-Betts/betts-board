import { pushSubscribeSchema } from '#shared/schemas/push'
import { useDb } from '../../db/client'
import { pushSubscriptions } from '../../db/schema'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const input = await readValidatedBody(event, pushSubscribeSchema.parse)
  const hh = requireHousehold()

  // Upsert by endpoint: re-subscribing rebinds the device to the acting profile.
  return useDb().insert(pushSubscriptions).values({
    householdId: hh.id,
    profileId: profile.id,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    userAgent: input.userAgent ?? null,
  }).onConflictDoUpdate({
    target: pushSubscriptions.endpoint,
    set: {
      profileId: profile.id,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent ?? null,
      failCount: 0,
    },
  }).returning().get()
})
