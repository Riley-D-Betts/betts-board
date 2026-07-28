import { createError } from 'h3'

// Overridable for tests and for self-hosters routing through an egress proxy.
const OPEN_METEO_URL = process.env.BETTS_OPEN_METEO_URL || 'https://api.open-meteo.com/v1/forecast'
const FETCH_TIMEOUT_MS = 10_000

/**
 * The condition buckets the WMO codes collapse into. Language-neutral by
 * design: the client translates these (`common.weather.<key>`), which is why
 * the set is exported rather than inlined — a new bucket here needs a message
 * in every locale, and the test in tests/unit/photos.spec.ts says so.
 */
export const WEATHER_CONDITION_KEYS = [
  'clear', 'partlyCloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'thunderstorm',
] as const

export type WeatherConditionKey = typeof WEATHER_CONDITION_KEYS[number]

export interface WeatherCondition {
  icon: string // i-lucide-* name
  conditionKey: WeatherConditionKey
  /** English, and staying that way: this is the wire contract other API
   * consumers already read. Screens render the translated `conditionKey` and
   * only fall back to this. Server strings are English per CLAUDE.md. */
  label: string
}

/** WMO weather codes (open-meteo `weathercode`) → icon + condition + label. */
export function describeWeatherCode(code: number): WeatherCondition {
  if (code === 0) return { icon: 'i-lucide-sun', conditionKey: 'clear', label: 'Clear' }
  if (code === 1 || code === 2) return { icon: 'i-lucide-cloud-sun', conditionKey: 'partlyCloudy', label: 'Partly cloudy' }
  if (code === 3) return { icon: 'i-lucide-cloud', conditionKey: 'cloudy', label: 'Cloudy' }
  if (code === 45 || code === 48) return { icon: 'i-lucide-cloud-fog', conditionKey: 'fog', label: 'Fog' }
  if (code >= 51 && code <= 57) return { icon: 'i-lucide-cloud-drizzle', conditionKey: 'drizzle', label: 'Drizzle' }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: 'i-lucide-cloud-rain', conditionKey: 'rain', label: 'Rain' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: 'i-lucide-cloud-snow', conditionKey: 'snow', label: 'Snow' }
  if (code >= 95) return { icon: 'i-lucide-cloud-lightning', conditionKey: 'thunderstorm', label: 'Thunderstorm' }
  return { icon: 'i-lucide-cloud', conditionKey: 'cloudy', label: 'Cloudy' }
}

export type TemperatureUnit = 'fahrenheit' | 'celsius'

export interface WeatherReport {
  configured: true
  unit: TemperatureUnit
  current: {
    temperature: number
    windspeed: number
    weathercode: number
    isDay: boolean
    icon: string
    conditionKey: WeatherConditionKey
    label: string
  }
  daily: {
    date: string // YYYY-MM-DD in the location's timezone
    weathercode: number
    icon: string
    conditionKey: WeatherConditionKey
    label: string
    tempMax: number
    tempMin: number
    precipitationProbability: number | null
  }[]
  fetchedAt: number
}

interface OpenMeteoResponse {
  current_weather?: {
    temperature: number
    windspeed: number
    weathercode: number
    is_day: 0 | 1
  }
  daily?: {
    time: string[]
    weathercode: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: (number | null)[]
  }
}

/** Server-side memo: shields open-meteo from repeated hits without letting
 * browsers cache responses (a settings change must show up immediately). */
const memo = new Map<string, { report: WeatherReport, at: number }>()
const MEMO_TTL_MS = 15 * 60_000

export async function fetchForecastCached(
  latitude: number,
  longitude: number,
  unit: TemperatureUnit = 'fahrenheit',
): Promise<WeatherReport> {
  const key = `${latitude},${longitude},${unit}`
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.report
  const report = await fetchForecast(latitude, longitude, unit)
  memo.set(key, { report, at: Date.now() })
  return report
}

/** 5-day forecast from open-meteo (no API key). Throws 502 when unreachable. */
export async function fetchForecast(
  latitude: number,
  longitude: number,
  unit: TemperatureUnit = 'fahrenheit',
): Promise<WeatherReport> {
  const url = new URL(OPEN_METEO_URL)
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('current_weather', 'true')
  url.searchParams.set('daily', 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '5')
  // open-meteo defaults to celsius; only the override needs sending.
  if (unit === 'fahrenheit') url.searchParams.set('temperature_unit', 'fahrenheit')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let body: OpenMeteoResponse
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    body = await res.json() as OpenMeteoResponse
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'Weather service unavailable' })
  }
  finally {
    clearTimeout(timer)
  }

  const current = body.current_weather
  if (!current || !body.daily) {
    throw createError({ statusCode: 502, statusMessage: 'Weather service returned an unexpected response' })
  }

  return {
    configured: true,
    unit,
    current: {
      temperature: current.temperature,
      windspeed: current.windspeed,
      weathercode: current.weathercode,
      isDay: current.is_day === 1,
      ...describeWeatherCode(current.weathercode),
    },
    daily: body.daily.time.map((date, i) => ({
      date,
      weathercode: body.daily!.weathercode[i]!,
      ...describeWeatherCode(body.daily!.weathercode[i]!),
      tempMax: body.daily!.temperature_2m_max[i]!,
      tempMin: body.daily!.temperature_2m_min[i]!,
      precipitationProbability: body.daily!.precipitation_probability_max[i] ?? null,
    })),
    fetchedAt: Date.now(),
  }
}
