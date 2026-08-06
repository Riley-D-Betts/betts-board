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

/**
 * One movement of the projection, in the order it was applied. The ledger is
 * the same walk as `days` shown one step at a time — the debugging view for
 * "why is my lowest balance THAT?", where a headline nobody can retrace is a
 * headline nobody trusts.
 */
export interface ForecastLedgerItem {
  date: string
  /** The bill or income name; null for the synthetic spending and goal rows. */
  name: string | null
  kind: 'income' | 'bill' | 'goal' | 'spending'
  /** Signed: income positive, money out negative. */
  amountMinor: number
  /** Running balance after this movement. */
  balanceMinor: number
}

export interface ForecastResult {
  currency: string
  currencyExponent: number
  openingBalanceMinor: number
  days: ForecastDay[]
  ledger: ForecastLedgerItem[]
  /** The one number a family acts on. */
  lowest: { date: string, balanceMinor: number }
  endingBalanceMinor: number
  totalBillsMinor: number
  totalIncomeMinor: number
  /** Set when the projection dips below zero, with the first date it happens. */
  shortfall: { date: string, balanceMinor: number } | null
}

export function projectCashFlow(snapshot: ForecastSnapshot): ForecastResult {
  const byDate = new Map<string, { name: string, kind: 'income' | 'bill', amountMinor: number }[]>()

  for (const occurrence of snapshot.occurrences) {
    // A bill somebody already paid or skipped has had its effect (or won't
    // have one) — projecting it again would double-count the month's rent.
    if (occurrence.status !== 'due') continue
    if (occurrence.currency !== snapshot.currency) continue // never sum across currencies

    const list = byDate.get(occurrence.dueDate) ?? []
    list.push({
      name: occurrence.name,
      kind: occurrence.kind === 'income' ? 'income' : 'bill',
      amountMinor: Math.abs(occurrence.amountMinor),
    })
    byDate.set(occurrence.dueDate, list)
  }

  const contributions = new Map<string, number>()
  for (const c of snapshot.goalContributions ?? []) {
    contributions.set(c.date, (contributions.get(c.date) ?? 0) + Math.abs(c.amountMinor))
  }

  const days: ForecastDay[] = []
  const ledger: ForecastLedgerItem[] = []
  let balance = snapshot.openingBalanceMinor
  let totalBills = 0
  let totalIncome = 0

  for (let i = 0; i < snapshot.days; i++) {
    const date = addDaysToDateString(snapshot.today, i)
    // Income first, then bills, alphabetical within each. The order inside a
    // day is a convention (the chart only sees day ends), but this one is the
    // only one that keeps the ledger honest: once the day's money has landed,
    // the running balance only descends, so the lowest row in the ledger IS
    // the lowest day the headline reports. Bills-before-income would show an
    // intra-day dip below a floor the headline never mentions.
    const movements = (byDate.get(date) ?? []).sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'income' ? -1 : 1)

    let dayBills = 0
    let dayIncome = 0
    for (const movement of movements) {
      const signed = movement.kind === 'income' ? movement.amountMinor : -movement.amountMinor
      balance += signed
      if (movement.kind === 'income') dayIncome += movement.amountMinor
      else dayBills += movement.amountMinor
      ledger.push({ date, name: movement.name, kind: movement.kind, amountMinor: signed, balanceMinor: balance })
    }

    const goal = contributions.get(date) ?? 0
    if (goal) {
      balance -= goal
      ledger.push({ date, name: null, kind: 'goal', amountMinor: -goal, balanceMinor: balance })
    }
    if (snapshot.dailyDiscretionaryMinor) {
      balance -= snapshot.dailyDiscretionaryMinor
      ledger.push({ date, name: null, kind: 'spending', amountMinor: -snapshot.dailyDiscretionaryMinor, balanceMinor: balance })
    }

    totalBills += dayBills
    totalIncome += dayIncome

    days.push({
      date,
      balanceMinor: balance,
      billsMinor: dayBills,
      incomeMinor: dayIncome,
      discretionaryMinor: snapshot.dailyDiscretionaryMinor + goal,
    })
  }

  // The floor has to be a day the projection actually contains. Seeding it with
  // the OPENING balance dated `today` reported a number that appears nowhere in
  // `days`: day 0 carries the same date but a different balance, once its own
  // bills, income and everyday spend are applied. The headline then disagreed
  // with the point the chart draws for `lowest.date` — which resolves to day 0
  // — and on a day money comes in, it under-reported the floor outright. The
  // opening balance is where the money is now, not somewhere it is projected to
  // go, so it is only the answer when there is nothing to project at all.
  let lowest = days[0]
    ? { date: days[0].date, balanceMinor: days[0].balanceMinor }
    : { date: snapshot.today, balanceMinor: snapshot.openingBalanceMinor }
  for (const day of days) {
    if (day.balanceMinor < lowest.balanceMinor) {
      lowest = { date: day.date, balanceMinor: day.balanceMinor }
    }
  }

  const shortfallDay = days.find(d => d.balanceMinor < 0) ?? null

  return {
    currency: snapshot.currency,
    currencyExponent: snapshot.currencyExponent,
    openingBalanceMinor: snapshot.openingBalanceMinor,
    days,
    ledger,
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
