/** Human-readable summary of a bare RRULE body, e.g.
 * "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE" → "Every 2 weeks on Mon, Wed". */

const DAY_NAMES: Record<string, string> = {
  MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun',
}

export function recurrenceText(rrule: string | null | undefined): string {
  if (!rrule) return 'Does not repeat'
  const parts = Object.fromEntries(
    rrule.split(';').map((kv) => {
      const [k, v] = kv.split('=')
      return [k?.toUpperCase(), v]
    }),
  ) as Record<string, string>

  const interval = Number(parts.INTERVAL || '1')
  const freq = parts.FREQ?.toUpperCase()
  const byday = parts.BYDAY?.split(',').map(d => DAY_NAMES[d.replace(/^[-\d]+/, '')] || d).join(', ')
  const bymonthday = parts.BYMONTHDAY

  let base: string
  switch (freq) {
    case 'DAILY':
      base = interval === 1 ? 'Daily' : `Every ${interval} days`
      break
    case 'WEEKLY':
      base = interval === 1 ? 'Weekly' : `Every ${interval} weeks`
      if (byday) base += ` on ${byday}`
      break
    case 'MONTHLY':
      base = interval === 1 ? 'Monthly' : interval === 3 ? 'Quarterly' : `Every ${interval} months`
      if (bymonthday) base += ` on day ${bymonthday}`
      break
    case 'YEARLY':
      base = interval === 1 ? 'Yearly' : `Every ${interval} years`
      break
    default:
      return rrule
  }

  if (parts.COUNT) base += `, ${parts.COUNT} times`
  else if (parts.UNTIL) base += ` until ${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`
  return base
}
