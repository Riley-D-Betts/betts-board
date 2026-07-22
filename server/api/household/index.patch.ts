import { eq } from 'drizzle-orm'
import { householdPatchSchema } from '#shared/schemas/household'
import { useDb } from '../../db/client'
import { households } from '../../db/schema'
import { requireAdmin, requireHousehold } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const patch = await readValidatedBody(event, householdPatchSchema.parse)
  const hh = requireHousehold()

  const updated = useDb().update(households).set({
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.timezone !== undefined && { timezone: patch.timezone }),
    ...(patch.latitude !== undefined && { latitude: patch.latitude }),
    ...(patch.longitude !== undefined && { longitude: patch.longitude }),
    ...(patch.locationName !== undefined && { locationName: patch.locationName }),
    ...(patch.settings !== undefined && {
      settings: {
        ...hh.settings,
        ...patch.settings,
        slideshow: { ...hh.settings.slideshow, ...patch.settings.slideshow },
        ...(patch.settings.appearance !== undefined && {
          appearance: { ...hh.settings.appearance, ...patch.settings.appearance },
        }),
      },
    }),
  }).where(eq(households.id, hh.id)).returning().get()

  return { ok: true, settings: updated.settings }
})
