import { fetchForecastCached } from '../services/weather/forecast'
import { requireHousehold, requireUnlocked } from '../utils/session'

// The 15-minute cache lives in the service (keyed by location + unit) so
// open-meteo isn't hammered. The response itself is marked no-store: browsers
// must not reuse it, or a unit/location change in settings looks like it did
// nothing until their HTTP cache expires.
export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const hh = requireHousehold()

  if (hh.latitude == null || hh.longitude == null) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Weather location not configured',
      data: { configured: false },
    })
  }

  setHeader(event, 'Cache-Control', 'no-store')
  return fetchForecastCached(hh.latitude, hh.longitude, hh.settings.temperatureUnit ?? 'fahrenheit')
})
