import type { WeatherCondition } from '~~/server/services/weather/forecast'

/**
 * Weather condition names in the board's language.
 *
 * /api/weather answers with a language-neutral `conditionKey` (the WMO code
 * collapsed into a bucket) *and* an English `label`. The label is the wire
 * contract other consumers already read, so it stays English and the
 * translation happens here instead — three screens render conditions (the TV
 * board, the slideshow overlay, the dashboard badge), which is why the
 * messages live in `common.weather.*` rather than one slice's file.
 *
 * A key with no message falls back to the server's English label, so a code
 * we have not bucketed yet reads oddly rather than rendering blank.
 */
export function useWeatherLabel() {
  const { t, te } = useI18n()

  /** Takes either half of the report: `weather.current` or a `daily` entry. */
  function weatherLabel(condition: Pick<WeatherCondition, 'conditionKey' | 'label'>): string {
    const path = `common.weather.${condition.conditionKey}`
    return te(path) ? t(path) : condition.label
  }

  return { weatherLabel }
}
