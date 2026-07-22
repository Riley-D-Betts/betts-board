import { fetchForecast } from '../services/weather/forecast'
import { requireHousehold, requireUnlocked } from '../utils/session'

// Cached: open-meteo asks integrations not to hammer their free API, and the
// forecast doesn't change minute-to-minute. Errors (including the 404 for an
// unconfigured location) are never cached.
export default cachedEventHandler(async (event) => {
  await requireUnlocked(event)
  const hh = requireHousehold()

  if (hh.latitude == null || hh.longitude == null) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Weather location not configured',
      data: { configured: false },
    })
  }

  return fetchForecast(hh.latitude, hh.longitude)
}, { maxAge: 900 })
