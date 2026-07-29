/**
 * Map a transaction onto the fields a bill is seeded from when someone turns a
 * transaction into a recurring bill. Pure and framework-free so the fiddly bits
 * — the sign→kind flip, the abs, the 80-char name cap — are unit-tested rather
 * than buried in a component template. The recurrence and the final save stay in
 * FinanceBillEditor; this only decides the pre-filled values.
 */

export interface TransactionForBill {
  description: string
  /** Signed, like every transaction amount: negative is money out. */
  amountMinor: number
  /** YYYY-MM-DD — becomes the bill's first due date verbatim, never TZ-shifted. */
  postedDate: string
  /** The single-split category, or null when the transaction is split. */
  categoryId: string | null
  accountId: string
}

export interface BillSeed {
  name: string
  kind: 'expense' | 'income'
  /** Non-negative — a bill carries its direction in `kind`, not the sign. */
  amountMinor: number
  startDate: string
  categoryId: string | null
  accountId: string
}

export function billSeedFromTransaction(txn: TransactionForBill): BillSeed {
  return {
    // A bill name maxes at 80; a description runs to 200, so it must be capped
    // here or the create 400s.
    name: txn.description.trim().slice(0, 80),
    // A positive transaction is money in (income); zero or negative is a bill.
    kind: txn.amountMinor > 0 ? 'income' : 'expense',
    amountMinor: Math.abs(txn.amountMinor),
    startDate: txn.postedDate,
    categoryId: txn.categoryId,
    accountId: txn.accountId,
  }
}
