import { resolveTvTheme } from '../../services/tv/theme'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const hh = requireHousehold()

  return resolveTvTheme({
    timezone: hh.timezone,
    latitude: hh.latitude,
    longitude: hh.longitude,
    preference: hh.settings.tv?.theme,
  }, new Date())
})
