import { eq } from 'drizzle-orm'
import { householdPatchSchema } from '#shared/schemas/household'
import { useDb } from '../../db/client'
import { households } from '../../db/schema'
import { mergeSettings } from '../../services/household/settings'
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
    // Recursive merge: a partial patch of any nested object leaves its
    // siblings alone, with no per-object merge line to forget.
    ...(patch.settings !== undefined && {
      settings: mergeSettings(hh.settings, patch.settings),
    }),
  }).where(eq(households.id, hh.id)).returning().get()

  return { ok: true, settings: updated.settings }
})
