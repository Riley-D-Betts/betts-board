/**
 * Describes a bare RRULE body for a person — as a MESSAGE DESCRIPTOR, not a
 * sentence.
 *
 * This used to concatenate English fragments: `'Every 2 weeks' + ' on ' + days`.
 * That is untranslatable. Spanish puts an article before the days ("los lun,
 * mié"), French uses a different one ("le lun, mer"), and neither language
 * builds the phrase in the order English does. Any design where the code
 * decides the word order can only ever produce English wearing a translation.
 *
 * So this file resolves the RRULE to a KEY plus its parameters and stops there.
 * The whole sentence lives in the locale file, where a translator can reorder
 * it freely. `useRecurrenceText()` turns a descriptor into text.
 *
 * Deliberately pure and free of any i18n import, so the RRULE parsing — the
 * part with actual edge cases — is unit-testable without mounting Vue.
 */

export interface RecurrenceDescriptor {
  /** i18n key under `calendar.recurrence`. */
  key: string
  params: Record<string, string | number>
  /**
   * A frame wrapping the base phrase — "{base} until {date}". Separate because
   * the base has to be resolved before the frame can take it as a parameter.
   */
  suffix?: { key: string, params: Record<string, string | number> }
  /**
   * Weekday codes (MO, TU…) in RRULE order. Rendered from the locale's own
   * calendar data rather than translated by hand — Luxon already knows what
   * Wednesday is called in French.
   */
  weekdays?: string[]
  /** An RRULE shape this does not describe: show it verbatim rather than lie. */
  raw?: string
}

const WEEKDAY_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

function parseRule(rrule: string): Record<string, string> {
  return Object.fromEntries(
    rrule.split(';').map((kv) => {
      const [k, v] = kv.split('=')
      return [k?.toUpperCase(), v]
    }),
  ) as Record<string, string>
}

/** `BYDAY=2MO,-1FR` → `['MO', 'FR']`; the ordinal prefix is not described. */
function weekdaysOf(byday: string | undefined): string[] | undefined {
  if (!byday) return undefined
  const codes = byday.split(',')
    .map(d => d.replace(/^[-+\d]+/, '').toUpperCase())
    .filter(d => WEEKDAY_ORDER.includes(d))
  return codes.length ? codes : undefined
}

export function describeRecurrence(rrule: string | null | undefined): RecurrenceDescriptor {
  if (!rrule) return { key: 'none', params: {} }

  const parts = parseRule(rrule)
  const interval = Number(parts.INTERVAL || '1')
  const freq = parts.FREQ?.toUpperCase()
  const weekdays = weekdaysOf(parts.BYDAY)
  const monthday = parts.BYMONTHDAY

  let key: string
  const params: Record<string, string | number> = {}

  switch (freq) {
    case 'DAILY':
      key = interval === 1 ? 'daily' : 'dailyEvery'
      break
    case 'WEEKLY':
      key = interval === 1
        ? (weekdays ? 'weeklyOn' : 'weekly')
        : (weekdays ? 'weeklyEveryOn' : 'weeklyEvery')
      break
    case 'MONTHLY':
      // Quarterly is called out because "every 3 months" is how a bill is
      // billed but not how anyone says it.
      key = interval === 1 ? 'monthly' : interval === 3 ? 'quarterly' : 'monthlyEvery'
      if (monthday) key += 'OnDay'
      break
    case 'YEARLY':
      key = interval === 1 ? 'yearly' : 'yearlyEvery'
      break
    default:
      // An RRULE with no FREQ, or one using a feature this does not cover.
      return { key: 'raw', params: {}, raw: rrule }
  }

  if (interval !== 1) params.n = interval
  if (monthday && freq === 'MONTHLY') params.day = monthday

  const descriptor: RecurrenceDescriptor = { key, params, ...(weekdays ? { weekdays } : {}) }

  if (parts.COUNT) {
    descriptor.suffix = { key: 'times', params: { n: Number(parts.COUNT) } }
  }
  else if (parts.UNTIL && parts.UNTIL.length >= 8) {
    // UNTIL is a basic-format timestamp; keep it as the YYYY-MM-DD calendar
    // string it denotes. It must never go through a locale date formatter
    // here — that is the caller's job, on a value it can parse.
    descriptor.suffix = {
      key: 'until',
      params: { date: `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}` },
    }
  }

  return descriptor
}
