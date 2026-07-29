import { and, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { financeBudgets, financeCategories } from '../../db/schema'
import { expandBills } from './bills'
import { spendByCategory } from './transactions'

/** YYYY-MM → the half-open [start, end) date window for that month. */
export function monthWindow(period: string): { start: string, end: string } {
  const [y, m] = period.split('-').map(Number)
  const nextYear = m === 12 ? y! + 1 : y!
  const nextMonth = m === 12 ? 1 : m! + 1
  return {
    start: `${period}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  }
}

export function previousMonth(period: string): string {
  const [y, m] = period.split('-').map(Number)
  const prevYear = m === 1 ? y! - 1 : y!
  const prevMonth = m === 1 ? 12 : m! - 1
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`
}

export function currentMonth(today: string): string {
  return today.slice(0, 7)
}

export interface BudgetLine {
  categoryId: string
  categoryName: string
  categoryIcon: string | null
  categoryColor: string | null
  kind: 'expense' | 'income' | 'transfer'
  budgetId: string | null
  amountMinor: number
  spentMinor: number
  /** Reserved by unpaid ('due') expense bills falling in this month. */
  committedMinor: number
  remainingMinor: number
  /** 0–1 for the bar; >1 when over. Null when there is no budget set. */
  progress: number | null
  rollover: boolean
  transactionCount: number
}

/**
 * The month's budget with spend-to-date.
 *
 * Spend is always DERIVED — never a stored running total, which would drift the
 * moment anyone recategorised a transaction or an import was undone.
 */
export function budgetForMonth(db: Db, householdId: string, period: string, currency: string) {
  const { start, end } = monthWindow(period)
  const budgets = db.select().from(financeBudgets)
    .where(and(eq(financeBudgets.householdId, householdId), eq(financeBudgets.periodStart, period)))
    .all()
  const byCategory = new Map(budgets.map(b => [b.categoryId, b]))

  const spend = new Map<string, { total: number, n: number }>()
  for (const row of spendByCategory(db, householdId, start, end)) {
    if (row.currency !== currency) continue // never sum across currencies
    if (!row.categoryId) continue
    const entry = spend.get(row.categoryId) ?? { total: 0, n: 0 }
    // Expenses are negative; budgets are positive magnitudes.
    entry.total += Math.abs(Math.min(0, row.totalMinor))
    entry.n += row.n
    spend.set(row.categoryId, entry)
  }

  // Unpaid bills reserve their category's budget. Only status 'due' counts:
  // marking a bill paid writes a finance_bill_payments row and NEVER a
  // transaction, so its real spend reaches budgets only through an actual
  // transaction — counting a paid bill here as well would double it.
  const committed = new Map<string, number>()
  for (const o of expandBills(db, householdId, start, end)) {
    if (o.status !== 'due') continue // exclude paid/skipped — the double-count guard
    if (o.kind !== 'expense') continue // income bills never reserve an expense budget
    if (o.currency !== currency) continue // never sum across currencies (mirrors spend)
    if (!o.categoryId) continue // uncategorized bills have no bar to reserve
    committed.set(o.categoryId, (committed.get(o.categoryId) ?? 0) + o.amountMinor)
  }

  const categories = db.select().from(financeCategories)
    .where(eq(financeCategories.householdId, householdId)).all()

  // An archived category keeps its history: hiding it from the list is fine,
  // but dropping it silently subtracts its spend from the month's total, so
  // the headline stops matching the transactions behind it. Archived
  // categories are shown for any month where they were actually used.
  const lines: BudgetLine[] = categories
    .filter(c => c.kind === 'expense'
      && (!c.archivedAt || spend.has(c.id) || byCategory.has(c.id) || committed.has(c.id)))
    .map((c) => {
      const budget = byCategory.get(c.id)
      const spent = spend.get(c.id)?.total ?? 0
      const reserved = committed.get(c.id) ?? 0
      const amountMinor = budget?.amountMinor ?? 0
      return {
        categoryId: c.id,
        categoryName: c.name,
        categoryIcon: c.icon,
        categoryColor: c.color,
        kind: c.kind,
        budgetId: budget?.id ?? null,
        amountMinor,
        spentMinor: spent,
        committedMinor: reserved,
        // Available nets out both real spend and money reserved by unpaid bills.
        remainingMinor: amountMinor - spent - reserved,
        // Fill fraction for the SPENT segment only; the reserved segment is drawn
        // separately client-side from committedMinor.
        progress: amountMinor > 0 ? spent / amountMinor : null,
        rollover: budget?.rollover ?? false,
        transactionCount: spend.get(c.id)?.n ?? 0,
      }
    })
    .sort((a, b) => (b.amountMinor - a.amountMinor) || a.categoryName.localeCompare(b.categoryName))

  const uncategorizedMinor = Math.abs(Math.min(0, spendByCategory(db, householdId, start, end)
    .filter(r => !r.categoryId && r.currency === currency)
    .reduce((acc, r) => acc + r.totalMinor, 0)))

  return {
    period,
    currency,
    lines,
    totalBudgetedMinor: lines.reduce((acc, l) => acc + l.amountMinor, 0),
    totalSpentMinor: lines.reduce((acc, l) => acc + l.spentMinor, 0),
    totalCommittedMinor: lines.reduce((acc, l) => acc + l.committedMinor, 0),
    uncategorizedMinor,
  }
}

export function setBudget(db: Db, householdId: string, input: {
  categoryId: string
  periodStart: string
  amountMinor: number
  rollover: boolean
  currency: string
}) {
  const existing = db.select().from(financeBudgets)
    .where(and(
      eq(financeBudgets.householdId, householdId),
      eq(financeBudgets.categoryId, input.categoryId),
      eq(financeBudgets.periodStart, input.periodStart),
    ))
    .get()

  if (existing) {
    return db.update(financeBudgets)
      .set({ amountMinor: input.amountMinor, rollover: input.rollover })
      .where(eq(financeBudgets.id, existing.id))
      .returning().get()
  }
  return db.insert(financeBudgets).values({ householdId, ...input }).returning().get()
}

/**
 * Copies last month's budget forward the first time a month is opened, so the
 * screen isn't empty every 1st. Only fills gaps — never overwrites an amount
 * somebody already set for this month.
 */
export function carryForwardBudgets(db: Db, householdId: string, period: string): number {
  const existing = db.select().from(financeBudgets)
    .where(and(eq(financeBudgets.householdId, householdId), eq(financeBudgets.periodStart, period)))
    .all()
  const have = new Set(existing.map(b => b.categoryId))

  const previous = db.select().from(financeBudgets)
    .where(and(eq(financeBudgets.householdId, householdId), eq(financeBudgets.periodStart, previousMonth(period))))
    .all()

  const toCopy = previous.filter(b => !have.has(b.categoryId))
  if (!toCopy.length) return 0

  db.insert(financeBudgets).values(toCopy.map(b => ({
    householdId,
    categoryId: b.categoryId,
    periodStart: period,
    amountMinor: b.amountMinor,
    currency: b.currency,
    rollover: b.rollover,
  }))).run()
  return toCopy.length
}

export function deleteBudget(db: Db, householdId: string, id: string): void {
  const row = db.select().from(financeBudgets)
    .where(and(eq(financeBudgets.id, id), eq(financeBudgets.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Budget not found' })
  db.delete(financeBudgets).where(eq(financeBudgets.id, id)).run()
}
