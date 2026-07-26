import { eq } from 'drizzle-orm'
import { householdFontSchema } from '#shared/schemas/fonts'
import { useDb } from '../../db/client'
import { households } from '../../db/schema'
import { downloadGoogleFont } from '../../services/fonts/google'
import { mergeSettings } from '../../services/household/settings'
import { fontsDir } from '../../utils/dataDir'
import { checkRateLimit } from '../../utils/rateLimit'
import { requireAdmin, requireHousehold } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireAdmin(event)
  // Downloading hits the network; don't let a stuck client hammer it.
  if (!checkRateLimit(`font:${profile.id}`, 5, 1)) {
    throw createError({ statusCode: 429, statusMessage: 'Too many downloads — wait a minute' })
  }

  const { family } = await readValidatedBody(event, householdFontSchema.parse)
  const hh = requireHousehold()

  const downloaded = await downloadGoogleFont(family, fontsDir())

  const updated = useDb().update(households)
    .set({
      settings: mergeSettings(hh.settings, {
        appearance: { customFont: downloaded, font: 'custom' },
      }),
    })
    .where(eq(households.id, hh.id))
    .returning().get()

  return { ok: true, customFont: downloaded, settings: updated.settings }
})
