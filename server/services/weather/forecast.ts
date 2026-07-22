import { createError } from 'h3'

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
const FETCH_TIMEOUT_MS = 10_000

export interface WeatherCondition {
  icon: string // i-lucide-* name
  label: string
}

/** WMO weather codes (open-meteo `weathercode`) → icon + label. */
export function describeWeatherCode(code: number): WeatherCondition {
  if (code === 0) return { icon: 'i-lucide-sun', label: 'Clear' }
  if (code === 1 || code === 2) return { icon: 'i-lucide-cloud-sun', label: 'Partly cloudy' }
  if (code === 3) return { icon: 'i-lucide-cloud', label: 'Cloudy' }
  if (code === 45 || code === 48) return { icon: 'i-lucide-cloud-fog', label: 'Fog' }
  if (code >= 51 && code <= 57) return { icon: 'i-lucide-cloud-drizzle', label: 'Drizzle' }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: 'i-lucide-cloud-rain', label: 'Rain' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: 'i-lucide-cloud-snow', label: 'Snow' }
  if (code >= 95) return { icon: 'i-lucide-cloud-lightning', label: 'Thunderstorm' }
  return { icon: 'i-lucide-cloud', label: 'Cloudy' }
}

export interface WeatherReport {
  configured: true
  current: {
    temperature: number
    windspeed: number
    weathercode: number
    isDay: boolean
    icon: string
    label: string
  }
  daily: {
    date: string // YYYY-MM-DD in the location's timezone
    weathercode: number
    icon: string
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

/** 5-day forecast from open-meteo (no API key). Throws 502 when unreachable. */
export async function fetchForecast(latitude: number, longitude: number): Promise<WeatherReport> {
  const url = new URL(OPEN_METEO_URL)
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('current_weather', 'true')
  url.searchParams.set('daily', 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '5')

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
