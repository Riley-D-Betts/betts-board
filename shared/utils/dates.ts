/** Small date-string helpers shared by client and server. All work on
 * YYYY-MM-DD local calendar dates with no timezone conversion. */

export function toDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDateString(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

export function addDaysToDateString(s: string, days: number): string {
  const d = parseDateString(s)
  d.setDate(d.getDate() + days)
  return toDateString(d)
}

export function todayString(): string {
  return toDateString(new Date())
}

/** Compare YYYY-MM-DD strings (they sort lexicographically). */
export function dateStringDiffDays(a: string, b: string): number {
  return Math.round((parseDateString(a).getTime() - parseDateString(b).getTime()) / 86_400_000)
}
