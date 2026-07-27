import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { financeBillPayments, financeBills, financeCategories } from '../../db/schema'
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
}

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
      })
    }
  }

  return occurrences.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name))
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
