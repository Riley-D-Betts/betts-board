/**
 * Twice-a-month (semi-monthly) bills — the common paycheck cadence: two fixed
 * days of the month, expressed as a `BYMONTHDAY` rule the recurrence engine
 * already expands. `-1` is the last day of the month (rrule honours it, and it
 * sidesteps the short-month skip a literal 30/31 would cause). Kept pure so the
 * normalisation is unit-tested rather than buried in the editor, matching the
 * `billFromTransaction.ts` helper.
 */

/** Frequency-picker sentinel: not an RRULE — the editor resolves it from the two chosen days. */
export const SEMIMONTHLY = 'twice-monthly'

/** BYMONTHDAY value for the last day of the month. */
export const LAST_DAY = -1

/** Sort key that keeps positive days ascending and puts "last day" at the end. */
const order = (day: number) => (day === LAST_DAY ? 32 : day)

/** Build `FREQ=MONTHLY;BYMONTHDAY=5,20` from two chosen days (deduped, ordered). */
export function semimonthlyRule(dayA: number, dayB: number): string {
  const days = [...new Set([dayA, dayB])].sort((a, b) => order(a) - order(b))
  return `FREQ=MONTHLY;BYMONTHDAY=${days.join(',')}`
}

/** True for a twice-a-month rule: monthly with two or more BYMONTHDAY values. */
export function isSemimonthly(rrule: string | null | undefined): boolean {
  return rrule != null && /^FREQ=MONTHLY;BYMONTHDAY=-?\d+(?:,-?\d+)+$/.test(rrule)
}

/**
 * The two chosen days read back out of a twice-a-month rule, so re-opening the
 * editor on an existing bill shows the days it actually has rather than the
 * 1st-and-15th default. The inverse of `semimonthlyRule`.
 *
 * Returns null for anything the two pickers cannot represent — including a
 * three-day BYMONTHDAY rule, which only the API can create. Declining lets the
 * caller keep the rule untouched; guessing two of the three days would quietly
 * delete the third the next time somebody pressed Save.
 */
export function semimonthlyDays(rrule: string | null | undefined): [number, number] | null {
  if (!isSemimonthly(rrule)) return null
  const raw = /BYMONTHDAY=(.+)$/.exec(rrule!)?.[1]
  if (!raw) return null
  const days = raw.split(',').map(Number).sort((a, b) => order(a) - order(b))
  if (days.length !== 2 || days.some(Number.isNaN)) return null
  return [days[0]!, days[1]!]
}

/** Resolve a BYMONTHDAY value (incl. -1 = last day) to a YYYY-MM-DD in a given month. */
function resolveDay(year: number, month0: number, day: number): string {
  const dom = day === LAST_DAY ? new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate() : day
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(dom).padStart(2, '0')}`
}

/**
 * The first pay day on or after `from` (a YYYY-MM-DD). Used as the bill's
 * startDate so it is itself a real occurrence — the expander always treats the
 * startDate as an occurrence, so anchoring it off the pay days would emit a
 * spurious due date. Starting from "today" also avoids surfacing this month's
 * already-past pay days as overdue.
 */
export function firstSemimonthlyOnOrAfter(from: string, dayA: number, dayB: number): string {
  const [y, m] = from.split('-').map(Number)
  let year = y!
  let month0 = m! - 1
  // Two months is always enough to find the next of two monthly days.
  for (let i = 0; i < 3; i++) {
    const dates = [resolveDay(year, month0, dayA), resolveDay(year, month0, dayB)].sort()
    for (const d of dates) if (d >= from) return d
    month0 += 1
    if (month0 > 11) { month0 = 0; year += 1 }
  }
  return resolveDay(year, month0, dayA) // unreachable in practice
}
