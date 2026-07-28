import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { financeRules, financeTransactionSplits, financeTransactions } from '../../db/schema'

export type RuleRow = typeof financeRules.$inferSelect

/**
 * Auto-categorisation. There is deliberately no regex option: Node gives no
 * way to abort a runaway pattern, so one bad rule typed by a family member
 * would wedge every sync — and contains/startsWith/equals covers what people
 * actually write ("AMAZON", "SAFEWAY #", "Netflix").
 */
export interface RuleTarget {
  description: string
  payee?: string | null
  memo?: string | null
  accountId: string
}

export function matchesRule(rule: Pick<RuleRow, 'matchField' | 'matchType' | 'matchValue' | 'accountId'>, txn: RuleTarget): boolean {
  if (rule.accountId && rule.accountId !== txn.accountId) return false
  const field = (txn[rule.matchField] ?? '').toLowerCase()
  if (!field) return false
  const needle = rule.matchValue.trim().toLowerCase()
  if (!needle) return false

  switch (rule.matchType) {
    case 'startsWith': return field.startsWith(needle)
    case 'equals': return field === needle
    default: return field.includes(needle)
  }
}

export interface RuleEffect {
  categoryId?: string | null
  payee?: string | null
}

/** First match by priority wins — predictable, and easy to explain in the UI. */
export function applyRules(rules: RuleRow[], txn: RuleTarget): RuleEffect | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (!matchesRule(rule, txn)) continue
    return {
      ...(rule.setCategoryId ? { categoryId: rule.setCategoryId } : {}),
      ...(rule.setPayee ? { payee: rule.setPayee } : {}),
    }
  }
  return null
}

export function listRules(db: Db, householdId: string): RuleRow[] {
  return db.select().from(financeRules)
    .where(eq(financeRules.householdId, householdId))
    .orderBy(asc(financeRules.priority), asc(financeRules.createdAt))
    .all()
}

export function createRule(db: Db, householdId: string, input: Record<string, unknown>) {
  return db.insert(financeRules).values({ householdId, ...input } as never).returning().get()
}

export function patchRule(db: Db, householdId: string, id: string, patch: Record<string, unknown>) {
  const row = db.select().from(financeRules)
    .where(and(eq(financeRules.id, id), eq(financeRules.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Rule not found' })
  return db.update(financeRules).set(patch as never).where(eq(financeRules.id, id)).returning().get()
}

export function deleteRule(db: Db, householdId: string, id: string): void {
  const row = db.select().from(financeRules)
    .where(and(eq(financeRules.id, id), eq(financeRules.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Rule not found' })
  db.delete(financeRules).where(eq(financeRules.id, id)).run()
}

/**
 * Re-run rules over existing rows.
 *
 * `onlyUncategorized` defaults true and the sweep never overwrites a
 * `categorizedBy: 'user'` line even when false: someone hand-filing a
 * transaction is a stronger signal than any pattern, and silently undoing that
 * work is the fastest way to make people stop trusting the feature.
 *
 * A transaction SPLIT across categories is skipped outright. Dividing a receipt
 * by hand is the strongest statement of intent there is, and a rule collapsing
 * it back to one category would destroy that work with nothing on screen to say
 * it happened.
 */
export function runRules(db: Db, householdId: string, opts: { onlyUncategorized: boolean }): { updated: number } {
  const rules = listRules(db, householdId)
  if (!rules.length) return { updated: 0 }

  const rows = db.select({
    txn: financeTransactions,
    splitCount: sql<number>`(
      select count(*) from ${financeTransactionSplits}
      where ${financeTransactionSplits.transactionId} = ${financeTransactions.id}
    )`,
  })
    .from(financeTransactions)
    .where(opts.onlyUncategorized
      ? and(
          eq(financeTransactions.householdId, householdId),
          sql`exists (
            select 1 from ${financeTransactionSplits}
            where ${financeTransactionSplits.transactionId} = ${financeTransactions.id}
              and ${financeTransactionSplits.categoryId} is null
          )`,
        )
      : eq(financeTransactions.householdId, householdId))
    .all()

  let updated = 0
  for (const { txn, splitCount } of rows) {
    if (splitCount > 1) continue // hand-split: leave it alone

    const split = db.select().from(financeTransactionSplits)
      .where(eq(financeTransactionSplits.transactionId, txn.id)).get()
    if (split?.categorizedBy === 'user') continue

    const effect = applyRules(rules, txn)
    if (!effect) continue
    if (effect.categoryId === split?.categoryId && (effect.payee ?? txn.payee) === txn.payee) continue

    if (effect.categoryId !== undefined && split) {
      db.update(financeTransactionSplits)
        .set({ categoryId: effect.categoryId, categorizedBy: 'rule' })
        .where(eq(financeTransactionSplits.id, split.id))
        .run()
    }
    if (effect.payee) {
      db.update(financeTransactions).set({ payee: effect.payee })
        .where(eq(financeTransactions.id, txn.id)).run()
    }
    updated++
  }
  return { updated }
}
