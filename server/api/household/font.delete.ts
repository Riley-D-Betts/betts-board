import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { households } from '../../db/schema'
import { mergeSettings } from '../../services/household/settings'
import { fontsDir } from '../../utils/dataDir'
import { requireAdmin, requireHousehold } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const hh = requireHousehold()
  const existing = hh.settings.appearance?.customFont

  if (existing?.slug) {
    // Best-effort: the settings row is what matters, a stray directory is not.
    try {
      rmSync(join(fontsDir(), existing.slug), { recursive: true, force: true })
    }
    catch { /* ignore */ }
  }

  const updated = useDb().update(households)
    .set({
      settings: mergeSettings(hh.settings, {
        appearance: {
          customFont: null,
          // Fall back to the default rather than leaving 'custom' dangling.
          ...(hh.settings.appearance?.font === 'custom' && { font: 'rounded' }),
        },
      }),
    })
    .where(eq(households.id, hh.id))
    .returning().get()

  return { ok: true, settings: updated.settings }
})
