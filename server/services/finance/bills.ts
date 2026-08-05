import { and, eq, gt, gte, inArray, isNotNull, isNull, lte, notInArray } from 'drizzle-orm'
import { addDaysToDateString, dateStringDiffDays, todayString } from '#shared/utils/dates'
import type { Db } from '../../db/client'
import {
  financeAccounts, financeBillPayments, financeBills, financeCategories,
  financeTransactions, financeTransactionSplits,
} from '../../db/schema'
import { expandDateRule } from '../calendar/recurrence'

export type BillRow = typeof financeBills.$inferSelect

export interface BillOccurrence {
  billId: string
  name: string
  kind: 'expense' | 'income'
  /** YYYY-MM-DD. */
  dueDate: string
  amountMinor: number
  currency: string
  categoryId: string | null
  categoryName: string | null
  accountId: string | null
  autoPay: boolean
  status: 'due' | 'paid' | 'skipped'
  paidAmountMinor: number | null
  transactionId: string | null
  /**
   * True when the status came from a deposit this code matched, not from a
   * person. Lets the UI say "received" rather than "marked paid", and marks the
   * status as re-derived on every read — nothing was written down.
   */
  autoMatched: boolean
}

/**
 * How far either side of its due date a deposit still counts as this income.
 * Payroll lands early for a weekend or late for a bank holiday; five days
 * covers that without letting one fortnight's pay settle the next one's.
 */
const INCOME_MATCH_WINDOW_DAYS = 5

/**
 * How far the amount may drift and still be the same paycheck. Hours, overtime
 * and tax changes move the figure every period, so an exact match would settle
 * almost nothing — but an open-ended tolerance would let any large deposit
 * (a transfer, a refund, the sale of a car) silently settle the month's income.
 */
const INCOME_MATCH_TOLERANCE = 0.25

/**
 * How far back the matcher looks for unsettled income, measured from today and
 * NOT from the window being expanded. That anchoring is the point: matching is
 * recomputed on every read, so if the candidate set depended on the requested
 * window, the overview's three expansions (overdue, upcoming, forecast) would
 * each solve a different matching problem over the same deposits — and one
 * deposit could settle occurrence A in one card and occurrence B in the next.
 * A universe fixed per (household, today) makes every window agree.
 *
 * Income older than this stays exactly as entered. No screen shows income
 * occurrences more than 30 days back, so sixty is margin, not a cliff.
 */
const INCOME_MATCH_LOOKBACK_DAYS = 60

/**
 * Bills recur through the calendar's own date-mode expander — the same code
 * path chores use, and the only place rrule is imported. They emphatically do
 * NOT become rows in the `events` table: the ICS export route hands the whole
 * calendar to anyone holding a token every unlocked client already has, and
 * GET /api/calendar feeds the wall display. Bills stay inside Finance.
 *
 * Occurrences are virtual; only the ones somebody acted on exist as rows, the
 * same shape as event exceptions.
 */
export function expandBills(db: Db, householdId: string, windowStart: string, windowEnd: string): BillOccurrence[] {
  const occurrences = expandOccurrences(db, householdId, windowStart, windowEnd)
  reconcileIncome(db, householdId, occurrences)
  return occurrences.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name))
}

/** The raw expansion — schedule plus overrides, no matching. */
function expandOccurrences(db: Db, householdId: string, windowStart: string, windowEnd: string): BillOccurrence[] {
  const bills = db.select({ bill: financeBills, categoryName: financeCategories.name })
    .from(financeBills)
    .leftJoin(financeCategories, eq(financeCategories.id, financeBills.categoryId))
    .where(and(eq(financeBills.householdId, householdId), isNull(financeBills.archivedAt)))
    .all()

  const occurrences: BillOccurrence[] = []

  for (const { bill, categoryName } of bills) {
    const dates = bill.rrule
      ? expandDateRule({
          rruleBody: bill.rrule,
          startDate: bill.startDate,
          windowStart,
          windowEnd,
        })
      : (bill.startDate >= windowStart && bill.startDate < windowEnd ? [bill.startDate] : [])

    const capped = bill.recurrenceEnd ? dates.filter(d => d <= bill.recurrenceEnd!) : dates
    const overrides = new Map(
      db.select().from(financeBillPayments).where(eq(financeBillPayments.billId, bill.id)).all()
        .map(p => [p.dueDate, p]),
    )

    for (const dueDate of capped) {
      const override = overrides.get(dueDate)
      occurrences.push({
        billId: bill.id,
        name: bill.name,
        kind: bill.kind,
        dueDate,
        amountMinor: bill.amountMinor,
        currency: bill.currency,
        categoryId: bill.categoryId,
        categoryName,
        accountId: bill.accountId,
        autoPay: bill.autoPay,
        status: override?.status ?? 'due',
        paidAmountMinor: override?.amountMinor ?? null,
        transactionId: override?.transactionId ?? null,
        autoMatched: false,
      })
    }
  }

  return occurrences
}

/**
 * Settle past income against the deposits that actually landed.
 *
 * "Overdue" is a coherent idea for a bill and an incoherent one for a paycheck:
 * an unpaid bill is a liability somebody has to act on, while income that has
 * not arrived is simply not here yet. Nobody opens the board to tick off their
 * own wages, so every past income occurrence sat in the overdue list forever,
 * nagging in red — the bank had the deposit the whole time.
 *
 * Matching is COMPUTED, never written down, matching the rule that occurrences
 * are virtual and only what a person decided becomes a row. That means it
 * self-corrects: recategorise the deposit as a transfer, or delete it, and the
 * occurrence goes back to due, with no stale `finance_bill_payments` row to
 * reconcile against. A real override always wins — a decision somebody made by
 * hand is not for this function to overturn.
 *
 * The matching problem is always solved over the same fixed universe — every
 * unsettled income occurrence of the last INCOME_MATCH_LOOKBACK_DAYS, whatever
 * window this expansion was asked for. One page composes several expansions
 * (the overview alone runs overdue, upcoming and forecast windows), and if
 * each solved only its own slice, a deposit already claimed by an occurrence
 * in one window would be free again in the next — one paycheck's money
 * settling two occurrences across cards that render side by side.
 *
 * Mutates `occurrences` in place.
 */
function reconcileIncome(db: Db, householdId: string, occurrences: BillOccurrence[]): void {
  const today = todayString()
  // Only income, only unresolved, and only in the past: a deposit sitting on a
  // future due date is somebody else's money, not next month's pay arriving early.
  const requested = occurrences
    .filter(o => o.kind === 'income' && o.status === 'due' && o.dueDate <= today)
  if (!requested.length) return

  // The whole candidate set, not just this window's slice (see the doc comment).
  // Occurrences older than the lookback never match and simply stay due.
  const universe = expandOccurrences(
    db, householdId,
    addDaysToDateString(today, -INCOME_MATCH_LOOKBACK_DAYS),
    addDaysToDateString(today, 1), // end-exclusive, so this includes today
  ).filter(o => o.kind === 'income' && o.status === 'due')
  if (!universe.length) return

  const universeDates = universe.map(o => o.dueDate).sort()
  const deposits = db.select({
    id: financeTransactions.id,
    accountId: financeTransactions.accountId,
    postedDate: financeTransactions.postedDate,
    amountMinor: financeTransactions.amountMinor,
    currency: financeTransactions.currency,
  })
    .from(financeTransactions)
    .innerJoin(financeAccounts, eq(financeAccounts.id, financeTransactions.accountId))
    .where(and(
      eq(financeTransactions.householdId, householdId),
      // A hold is not money received, and money out is never income.
      eq(financeTransactions.pending, false),
      gt(financeTransactions.amountMinor, 0),
      // Positive money on a credit or loan account is a payment against the
      // balance — the household paying its card, not being paid. Without this,
      // a card payment the size of a paycheck marks the wages "received".
      notInArray(financeAccounts.type, ['credit', 'loan']),
      gte(financeTransactions.postedDate, addDaysToDateString(universeDates[0]!, -INCOME_MATCH_WINDOW_DAYS)),
      lte(financeTransactions.postedDate, addDaysToDateString(universeDates.at(-1)!, INCOME_MATCH_WINDOW_DAYS)),
    ))
    .all()
  if (!deposits.length) return

  // Money the household moved between its own accounts is not income, however
  // paycheck-sized. The rest of the module already treats transfer-kind lines
  // as not-money-movement (averageDailySpend); the same judgement applies here,
  // and it is what makes "recategorise as a transfer" undo a wrong match.
  const depositIds = deposits.map(d => d.id)
  const transferIds = new Set(
    db.select({ transactionId: financeTransactionSplits.transactionId })
      .from(financeTransactionSplits)
      .innerJoin(financeCategories, eq(financeCategories.id, financeTransactionSplits.categoryId))
      .where(and(
        inArray(financeTransactionSplits.transactionId, depositIds),
        eq(financeCategories.kind, 'transfer'),
      ))
      .all().map(r => r.transactionId),
  )

  // A deposit somebody already attached to an occurrence by hand is spoken for
  // everywhere, including occurrences outside this expansion — otherwise the
  // same physical money settles one occurrence by override and a second one by
  // matching.
  const linkedIds = new Set(
    db.select({ transactionId: financeBillPayments.transactionId })
      .from(financeBillPayments)
      .innerJoin(financeBills, eq(financeBills.id, financeBillPayments.billId))
      .where(and(
        eq(financeBills.householdId, householdId),
        isNotNull(financeBillPayments.transactionId),
      ))
      .all().map(r => r.transactionId!),
  )

  const eligible = deposits.filter(d => !transferIds.has(d.id) && !linkedIds.has(d.id))

  // Every pairing that is allowed at all, scored, then assigned best fit first.
  // Walking the occurrences in date order and letting each take the first
  // deposit it tolerated was wrong: with fortnightly pay, the earlier occurrence
  // would claim a deposit that landed squarely on the LATER one, leaving the
  // later one unsettled and the earlier one settled against the wrong money.
  const pairs: { occurrence: BillOccurrence, id: string, amountMinor: number, gap: number, drift: number }[] = []

  for (const occurrence of universe) {
    for (const deposit of eligible) {
      if (deposit.currency !== occurrence.currency) continue // never across currencies
      // A bill tied to an account is only settled by money reaching THAT account.
      if (occurrence.accountId && deposit.accountId !== occurrence.accountId) continue

      const gap = Math.abs(dateStringDiffDays(deposit.postedDate, occurrence.dueDate))
      if (gap > INCOME_MATCH_WINDOW_DAYS) continue

      const drift = Math.abs(deposit.amountMinor - occurrence.amountMinor)
      if (drift > occurrence.amountMinor * INCOME_MATCH_TOLERANCE) continue

      pairs.push({ occurrence, id: deposit.id, amountMinor: deposit.amountMinor, gap, drift })
    }
  }

  // Nearest due date first, closest amount to break that tie, then due date,
  // bill and transaction id so the same data always settles the same way —
  // this is recomputed on every read, and a matching that flickered between
  // requests would move money around the screen for no reason. The bill id key
  // matters: two bills with the same due date and amount otherwise tie
  // completely, and the winner would fall to SQL row order, which nothing
  // guarantees.
  pairs.sort((a, b) =>
    a.gap - b.gap
    || a.drift - b.drift
    || a.occurrence.dueDate.localeCompare(b.occurrence.dueDate)
    || a.occurrence.billId.localeCompare(b.occurrence.billId)
    || a.id.localeCompare(b.id))

  // One deposit settles at most one occurrence, and one occurrence takes at most
  // one deposit. Without both, a fortnightly paycheck whose two due dates fall
  // inside one window would claim the same deposit twice and the household would
  // appear to have been paid twice.
  const claimedDeposits = new Set<string>()
  const settledKeys = new Set<string>()
  const assigned = new Map<string, { id: string, amountMinor: number }>()
  const keyOf = (o: BillOccurrence) => `${o.billId} ${o.dueDate}`

  for (const pair of pairs) {
    const key = keyOf(pair.occurrence)
    if (claimedDeposits.has(pair.id) || settledKeys.has(key)) continue
    claimedDeposits.add(pair.id)
    settledKeys.add(key)
    assigned.set(key, { id: pair.id, amountMinor: pair.amountMinor })
  }

  // The universe decided; only the requested occurrences are told.
  for (const occurrence of requested) {
    const match = assigned.get(keyOf(occurrence))
    if (!match) continue
    occurrence.status = 'paid'
    occurrence.transactionId = match.id
    // The amount that actually landed, not the estimate on the bill.
    occurrence.paidAmountMinor = match.amountMinor
    occurrence.autoMatched = true
  }
}

export function listBills(db: Db, householdId: string, includeArchived = false) {
  return db.select().from(financeBills)
    .where(includeArchived
      ? eq(financeBills.householdId, householdId)
      : and(eq(financeBills.householdId, householdId), isNull(financeBills.archivedAt)))
    .all()
    .map(b => ({ ...b, archivedAt: b.archivedAt?.getTime() ?? null, createdAt: b.createdAt.getTime(), updatedAt: b.updatedAt.getTime() }))
}

export function createBill(db: Db, householdId: string, input: Record<string, unknown>) {
  return db.insert(financeBills).values({ householdId, ...input } as never).returning().get()
}

export function patchBill(db: Db, householdId: string, id: string, patch: Record<string, unknown>) {
  const row = db.select().from(financeBills)
    .where(and(eq(financeBills.id, id), eq(financeBills.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Bill not found' })

  const { archived, ...rest } = patch as { archived?: boolean }
  const values: Record<string, unknown> = { ...rest }
  if (archived !== undefined) values.archivedAt = archived ? new Date() : null
  return db.update(financeBills).set(values).where(eq(financeBills.id, id)).returning().get()
}

export function deleteBill(db: Db, householdId: string, id: string): void {
  const row = db.select().from(financeBills)
    .where(and(eq(financeBills.id, id), eq(financeBills.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Bill not found' })
  db.delete(financeBills).where(eq(financeBills.id, id)).run()
}

/** Materialises one occurrence — the only time a bill occurrence becomes a row. */
export function markBillOccurrence(db: Db, householdId: string, billId: string, input: {
  dueDate: string
  status: 'paid' | 'skipped'
  amountMinor?: number
  transactionId?: string | null
}) {
  const bill = db.select().from(financeBills)
    .where(and(eq(financeBills.id, billId), eq(financeBills.householdId, householdId))).get()
  if (!bill) throw createError({ statusCode: 404, statusMessage: 'Bill not found' })

  const existing = db.select().from(financeBillPayments)
    .where(and(eq(financeBillPayments.billId, billId), eq(financeBillPayments.dueDate, input.dueDate)))
    .get()

  const values = {
    status: input.status,
    paidAt: input.status === 'paid' ? new Date() : null,
    amountMinor: input.amountMinor ?? (input.status === 'paid' ? bill.amountMinor : null),
    transactionId: input.transactionId ?? null,
  }

  if (existing) {
    return db.update(financeBillPayments).set(values)
      .where(eq(financeBillPayments.id, existing.id)).returning().get()
  }
  return db.insert(financeBillPayments)
    .values({ billId, dueDate: input.dueDate, ...values }).returning().get()
}

/** Back to "due" — deletes the override row rather than storing a third state. */
export function clearBillOccurrence(db: Db, householdId: string, billId: string, dueDate: string): void {
  const bill = db.select().from(financeBills)
    .where(and(eq(financeBills.id, billId), eq(financeBills.householdId, householdId))).get()
  if (!bill) throw createError({ statusCode: 404, statusMessage: 'Bill not found' })
  db.delete(financeBillPayments)
    .where(and(eq(financeBillPayments.billId, billId), eq(financeBillPayments.dueDate, dueDate)))
    .run()
}
