import { asc, eq, inArray } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { financeCategories, financeTransactionSplits } from '../../db/schema'

/**
 * Reading and writing a transaction's category splits.
 *
 * Every transaction has at least one split; an ordinary one has exactly one
 * carrying the whole amount. There is no "is it split?" branch anywhere —
 * that dual path is what would let a call site under-count money silently.
 *
 * The invariant this file exists to protect:
 *   sum(splits.amountMinor) === transaction.amountMinor, exactly.
 * All integer minor units, so exact equality with no rounding tolerance.
 */

export type SplitRow = typeof financeTransactionSplits.$inferSelect

export interface SplitInput {
  categoryId?: string | null
  amountMinor: number
  note?: string | null
  /** Defaults to 'user' — anything coming through here was a person's choice. */
  categorizedBy?: 'rule' | 'user' | 'import' | null
}

export interface SplitDto {
  id: string
  categoryId: string | null
  categoryName: string | null
  categoryIcon: string | null
  categoryColor: string | null
  amountMinor: number
  note: string | null
}

/**
 * Rejects a set of parts that doesn't add up. Deliberately strict: a split
 * that is a penny out would quietly make the budget disagree with the account
 * balance, and nobody goes back and re-checks a number that looked plausible.
 */
export function assertSplitsBalance(parts: SplitInput[], totalMinor: number): void {
  if (!parts.length) {
    throw createError({ statusCode: 400, statusMessage: 'A transaction needs at least one category line' })
  }
  for (const part of parts) {
    if (!Number.isSafeInteger(part.amountMinor)) {
      throw createError({ statusCode: 400, statusMessage: 'Split amounts must be whole minor units' })
    }
  }

  // Every line points the same way as the whole. Summing correctly is not
  // enough on its own: a £50 charge could be "split" into +£1000 and −£1050,
  // which balances while both budget lines are wildly wrong and the spend
  // average — which counts outflow lines only — reports a £1050 day.
  const sign = Math.sign(totalMinor)
  if (sign !== 0 && parts.some(p => p.amountMinor !== 0 && Math.sign(p.amountMinor) !== sign)) {
    throw createError({
      statusCode: 400,
      statusMessage: sign < 0
        ? 'Every line of a payment has to be a payment too'
        : 'Every line of a deposit has to be a deposit too',
    })
  }

  const sum = parts.reduce((acc, p) => acc + p.amountMinor, 0)
  if (sum !== totalMinor) {
    // Compared on magnitude, not on the signed difference. Spending is
    // negative, so lines adding to -70 against a -60 charge have a *positive*
    // difference while being over-assigned — the naive wording says "missing"
    // for exactly the case a person is most likely to hit.
    const overAssigned = Math.abs(sum) > Math.abs(totalMinor)
    throw createError({
      statusCode: 400,
      statusMessage: `The split lines add up to ${sum} but the transaction is ${totalMinor} `
        + `(${overAssigned ? 'over by' : 'short by'} ${Math.abs(totalMinor - sum)} minor units)`,
    })
  }
}

/**
 * Replaces a transaction's splits.
 *
 * Wrapped in a transaction because a half-applied replace would leave a
 * transaction whose splits no longer sum to it — breaking the invariant every
 * aggregation now depends on. Same pattern as services/rewards/store.ts.
 */
export function setSplits(db: Db, transactionId: string, totalMinor: number, parts: SplitInput[]): void {
  assertSplitsBalance(parts, totalMinor)

  db.transaction((tx) => {
    tx.delete(financeTransactionSplits)
      .where(eq(financeTransactionSplits.transactionId, transactionId))
      .run()

    tx.insert(financeTransactionSplits).values(parts.map((part, index) => ({
      transactionId,
      categoryId: part.categoryId ?? null,
      amountMinor: part.amountMinor,
      note: part.note ?? null,
      categorizedBy: part.categorizedBy ?? 'user',
      sortOrder: index,
    }))).run()
  })
}

/**
 * Re-fits a transaction's existing lines to a new total.
 *
 * For when the AMOUNT moved and there is nobody to ask: a bank amending a
 * restaurant charge once the tip posts, a hold settling higher than it was
 * authorised for. Sync cannot refuse that the way a hand edit is refused —
 * the money has already moved — and leaving the lines summing to the old
 * amount would break the invariant every aggregation depends on, silently and
 * for good.
 *
 * Lines are scaled proportionally rather than dumping the difference on one of
 * them. A tip really is proportional to the bill, no category is invented or
 * lost, and scaling can never flip a line's sign — which dumping a large
 * downward correction on one line very much can.
 */
export function rebalanceSplits(db: Db, transactionId: string, newTotalMinor: number): void {
  const rows = db.select().from(financeTransactionSplits)
    .where(eq(financeTransactionSplits.transactionId, transactionId))
    .orderBy(asc(financeTransactionSplits.sortOrder), asc(financeTransactionSplits.createdAt))
    .all()
  if (!rows.length) return

  const oldTotal = rows.reduce((acc, r) => acc + r.amountMinor, 0)
  if (oldTotal === newTotalMinor) return

  // One line, or a total of zero to scale from: the whole amount goes on the
  // first line, keeping its category. There is no ratio to preserve.
  if (rows.length === 1 || oldTotal === 0) {
    const amounts = rows.map((_, i) => (i === 0 ? newTotalMinor : 0))
    writeAmounts(db, rows, amounts)
    return
  }

  // BigInt so a large amount can't overflow the multiply before the divide.
  // Division truncates toward zero, so every scaled line is no bigger than its
  // exact share and the leftover carries the sign of the new total.
  const scaled = rows.map(r =>
    Number(BigInt(r.amountMinor) * BigInt(newTotalMinor) / BigInt(oldTotal)))
  const drift = newTotalMinor - scaled.reduce((acc, n) => acc + n, 0)

  // Onto the biggest line, where a penny or two is least visible and cannot
  // push a small line past zero.
  let biggest = 0
  for (let i = 1; i < scaled.length; i++) {
    if (Math.abs(scaled[i]!) > Math.abs(scaled[biggest]!)) biggest = i
  }
  scaled[biggest] = scaled[biggest]! + drift

  writeAmounts(db, rows, scaled)
}

function writeAmounts(db: Db, rows: SplitRow[], amounts: number[]): void {
  db.transaction((tx) => {
    rows.forEach((row, index) => {
      tx.update(financeTransactionSplits)
        .set({ amountMinor: amounts[index]! })
        .where(eq(financeTransactionSplits.id, row.id))
        .run()
    })
  })
}

/** The single split an ordinary transaction gets on create. */
export function singleSplit(input: {
  amountMinor: number
  categoryId?: string | null
  categorizedBy?: 'rule' | 'user' | 'import' | null
}): SplitInput[] {
  return [{
    categoryId: input.categoryId ?? null,
    amountMinor: input.amountMinor,
    categorizedBy: input.categoryId ? (input.categorizedBy ?? 'user') : null,
  }]
}

/**
 * Splits for many transactions at once, with their category display fields.
 * One query for a whole page rather than N+1.
 */
export function splitsFor(db: Db, transactionIds: string[]): Map<string, SplitDto[]> {
  const byTransaction = new Map<string, SplitDto[]>()
  if (!transactionIds.length) return byTransaction

  const rows = db.select({
    split: financeTransactionSplits,
    categoryName: financeCategories.name,
    categoryIcon: financeCategories.icon,
    categoryColor: financeCategories.color,
  })
    .from(financeTransactionSplits)
    .leftJoin(financeCategories, eq(financeCategories.id, financeTransactionSplits.categoryId))
    .where(inArray(financeTransactionSplits.transactionId, transactionIds))
    // Authored order, so the editor shows lines back in the order they were
    // typed. createdAt breaks ties from the migration backfill, which gave
    // every backfilled row sortOrder 0.
    .orderBy(asc(financeTransactionSplits.sortOrder), asc(financeTransactionSplits.createdAt))
    .all()

  for (const { split, categoryName, categoryIcon, categoryColor } of rows) {
    const list = byTransaction.get(split.transactionId) ?? []
    list.push({
      id: split.id,
      categoryId: split.categoryId,
      categoryName,
      categoryIcon,
      categoryColor,
      amountMinor: split.amountMinor,
      note: split.note,
    })
    byTransaction.set(split.transactionId, list)
  }

  return byTransaction
}

export function splitsForOne(db: Db, transactionId: string): SplitDto[] {
  return splitsFor(db, [transactionId]).get(transactionId) ?? []
}

/**
 * The convenience field the API still exposes: the category when a transaction
 * has exactly one split, null when it's genuinely split. Derived on read and
 * never stored — it keeps a Home Assistant script that reads `categoryId`
 * working for the ordinary case without becoming a second source of truth.
 */
export function derivedCategoryId(splits: SplitDto[]): string | null {
  return splits.length === 1 ? splits[0]!.categoryId : null
}

/** True once a person has actually divided this transaction up. */
export function isSplit(splits: SplitDto[]): boolean {
  return splits.length > 1
}
