import { fetchForecast } from '../services/weather/forecast'
import { getHousehold, requireHousehold, requireUnlocked } from '../utils/session'

// Cached: open-meteo asks integrations not to hammer their free API, and the
// forecast doesn't change minute-to-minute. Errors (including the 404 for an
// unconfigured location) are never cached. The key varies with location and
// unit so changing either in settings takes effect immediately.
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

  return fetchForecast(hh.latitude, hh.longitude, hh.settings.temperatureUnit ?? 'fahrenheit')
}, {
  maxAge: 900,
  getKey: () => {
    const hh = getHousehold()
    return `weather:${hh?.latitude},${hh?.longitude},${hh?.settings.temperatureUnit ?? 'fahrenheit'}`
  },
})
