import { requireUnlocked, requireHousehold } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const hh = requireHousehold()
  return {
    id: hh.id,
    name: hh.name,
    timezone: hh.timezone,
    latitude: hh.latitude,
    longitude: hh.longitude,
    locationName: hh.locationName,
    settings: hh.settings,
    icsToken: hh.icsToken,
    createdAt: hh.createdAt,
  }
})
