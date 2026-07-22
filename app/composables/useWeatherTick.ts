/** Bump this shared counter to make every weather widget refetch immediately
 * (e.g. after the household's temperature unit or location changes). */
export function useWeatherTick() {
  return useState('weather-refresh-tick', () => 0)
}
