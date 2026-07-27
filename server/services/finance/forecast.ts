import { addDaysToDateString } from '#shared/utils/dates'
import type { BillOccurrence } from './bills'

/**
 * Cash-flow projection.
 *
 * A PURE function over a snapshot object — no database access at all. That is
 * the point: this is the hardest part of the feature to reason about, and
 * making it a pure function means every edge case is a unit test rather than a
 * fixture-heavy integration test.
 */

export interface ForecastSnapshot {
  /** Today, YYYY-MM-DD. */
  today: string
  days: number
  currency: string
  currencyExponent: number
  /** Spendable balance now — cash accounts only, not credit or investments. */
  openingBalanceMinor: number
  /** Bill and income occurrences over the window (from expandBills). */
  occurrences: BillOccurrence[]
  /**
   * Everyday spend not covered by a bill, as a daily average from trailing
   * history. Zero when there isn't enough history to say.
   */
  dailyDiscretionaryMinor: number
  /** Planned savings transfers, keyed by date. */
  goalContributions?: { date: string, amountMinor: number }[]
}

export interface ForecastDay {
  date: string
  /** Projected end-of-day balance. */
  balanceMinor: number
  billsMinor: number
  incomeMinor: number
  discretionaryMinor: number
}

export interface ForecastResult {
  currency: string
  currencyExponent: number
  openingBalanceMinor: number
  days: ForecastDay[]
  /** The one number a family acts on. */
  lowest: { date: string, balanceMinor: number }
  endingBalanceMinor: number
  totalBillsMinor: number
  totalIncomeMinor: number
  /** Set when the projection dips below zero, with the first date it happens. */
  shortfall: { date: string, balanceMinor: number } | null
}

export function projectCashFlow(snapshot: ForecastSnapshot): ForecastResult {
  const byDate = new Map<string, { bills: number, income: number }>()

  for (const occurrence of snapshot.occurrences) {
    // A bill somebody already paid or skipped has had its effect (or won't
    // have one) — projecting it again would double-count the month's rent.
    if (occurrence.status !== 'due') continue
    if (occurrence.currency !== snapshot.currency) continue // never sum across currencies

    const entry = byDate.get(occurrence.dueDate) ?? { bills: 0, income: 0 }
    if (occurrence.kind === 'income') entry.income += Math.abs(occurrence.amountMinor)
    else entry.bills += Math.abs(occurrence.amountMinor)
    byDate.set(occurrence.dueDate, entry)
  }

  const contributions = new Map<string, number>()
  for (const c of snapshot.goalContributions ?? []) {
    contributions.set(c.date, (contributions.get(c.date) ?? 0) + Math.abs(c.amountMinor))
  }

  const days: ForecastDay[] = []
  let balance = snapshot.openingBalanceMinor
  let totalBills = 0
  let totalIncome = 0
  let lowest = { date: snapshot.today, balanceMinor: balance }

  for (let i = 0; i < snapshot.days; i++) {
    const date = addDaysToDateString(snapshot.today, i)
    const entry = byDate.get(date) ?? { bills: 0, income: 0 }
    const discretionary = snapshot.dailyDiscretionaryMinor + (contributions.get(date) ?? 0)

    balance += entry.income - entry.bills - discretionary
    totalBills += entry.bills
    totalIncome += entry.income

    days.push({
      date,
      balanceMinor: balance,
      billsMinor: entry.bills,
      incomeMinor: entry.income,
      discretionaryMinor: discretionary,
    })
    if (balance < lowest.balanceMinor) lowest = { date, balanceMinor: balance }
  }

  const shortfallDay = days.find(d => d.balanceMinor < 0) ?? null

  return {
    currency: snapshot.currency,
    currencyExponent: snapshot.currencyExponent,
    openingBalanceMinor: snapshot.openingBalanceMinor,
    days,
    lowest,
    endingBalanceMinor: balance,
    totalBillsMinor: totalBills,
    totalIncomeMinor: totalIncome,
    shortfall: shortfallDay ? { date: shortfallDay.date, balanceMinor: shortfallDay.balanceMinor } : null,
  }
}

/**
 * Average daily spend that isn't a bill, from trailing history.
 *
 * Income is excluded (it's modelled as bills of kind `income`, so counting it
 * here too would double it), and so are transfers between the family's own
 * accounts, which are not spending at all.
 */
export function averageDailySpend(args: {
  transactions: { amountMinor: number, currency: string, categoryKind?: string | null }[]
  days: number
  currency: string
}): number {
  if (args.days <= 0) return 0
  let total = 0
  for (const txn of args.transactions) {
    if (txn.currency !== args.currency) continue
    if (txn.amountMinor >= 0) continue
    if (txn.categoryKind === 'transfer') continue
    total += Math.abs(txn.amountMinor)
  }
  return Math.round(total / args.days)
}
