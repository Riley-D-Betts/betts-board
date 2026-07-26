/**
 * Sunrise and sunset from latitude, longitude, and date.
 *
 * Deliberately computed rather than fetched. Sun times are a deterministic
 * function of position and date, so routing them through the weather API would
 * add a network dependency, a 15-minute cache staleness window, and an outage
 * mode to a question that has none of those. This is the standard "sunrise
 * equation" solution: it lands within about five minutes of published tables
 * (it ignores observer elevation and uses a truncated equation of the centre),
 * which is far more precision than "should the wall display be light or dark"
 * requires.
 */

const DEG = Math.PI / 180
const J2000 = 2451545.0
/** Standard refraction-corrected solar altitude at sunrise/sunset. */
const ZENITH_OFFSET = -0.833

export type SunTimes =
  | { kind: 'normal', sunrise: Date, sunset: Date }
  /** Sun never sets (high latitude, midsummer). */
  | { kind: 'polar-day' }
  /** Sun never rises (high latitude, midwinter). */
  | { kind: 'polar-night' }

function toJulian(date: Date): number {
  return date.getTime() / 86_400_000 + 2440587.5
}

function fromJulian(julian: number): Date {
  return new Date((julian - 2440587.5) * 86_400_000)
}

export function sunTimes(latitude: number, longitude: number, date: Date): SunTimes {
  // Days since J2000, at the local mean solar noon for this longitude.
  const n = Math.round(toJulian(date) - J2000 - 0.0009 + longitude / 360)
  const meanSolarTime = n + 0.0009 - longitude / 360

  // Solar mean anomaly.
  const M = (357.5291 + 0.98560028 * meanSolarTime) % 360
  // Equation of the center.
  const C = 1.9148 * Math.sin(M * DEG)
    + 0.02 * Math.sin(2 * M * DEG)
    + 0.0003 * Math.sin(3 * M * DEG)
  // Ecliptic longitude.
  const lambda = (M + C + 180 + 102.9372) % 360

  const solarTransit = J2000 + meanSolarTime
    + 0.0053 * Math.sin(M * DEG)
    - 0.0069 * Math.sin(2 * lambda * DEG)

  // Declination of the sun.
  const sinDec = Math.sin(lambda * DEG) * Math.sin(23.44 * DEG)
  const cosDec = Math.cos(Math.asin(sinDec))

  // Hour angle. Out of range means the sun never crosses the horizon today.
  const cosOmega = (Math.sin(ZENITH_OFFSET * DEG) - Math.sin(latitude * DEG) * sinDec)
    / (Math.cos(latitude * DEG) * cosDec)
  if (cosOmega < -1) return { kind: 'polar-day' }
  if (cosOmega > 1) return { kind: 'polar-night' }

  const omega = Math.acos(cosOmega) / DEG
  return {
    kind: 'normal',
    sunrise: fromJulian(solarTransit - omega / 360),
    sunset: fromJulian(solarTransit + omega / 360),
  }
}

/** True when `at` falls between sunrise and sunset at the given location. */
export function isDaylight(latitude: number, longitude: number, at: Date): boolean {
  const times = sunTimes(latitude, longitude, at)
  if (times.kind === 'polar-day') return true
  if (times.kind === 'polar-night') return false
  return at >= times.sunrise && at < times.sunset
}
