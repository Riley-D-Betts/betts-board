import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { financeCategories, financeTransactions } from '../../db/schema'

/**
 * Seeded on first finance setup so the ledger is usable immediately — an empty
 * category list means every transaction lands in "uncategorised" and the
 * budgets screen has nothing to budget.
 *
 * These are `isSystem` only in the sense that they were seeded; they can be
 * renamed, recoloured, or archived like any other.
 */
const SEED: { name: string, kind: 'expense' | 'income' | 'transfer', icon: string, color: string }[] = [
  { name: 'Groceries', kind: 'expense', icon: 'i-lucide-shopping-cart', color: '#16a34a' },
  { name: 'Dining out', kind: 'expense', icon: 'i-lucide-utensils', color: '#f97316' },
  { name: 'Housing', kind: 'expense', icon: 'i-lucide-house', color: '#0ea5e9' },
  { name: 'Utilities', kind: 'expense', icon: 'i-lucide-plug', color: '#6366f1' },
  { name: 'Transport', kind: 'expense', icon: 'i-lucide-car', color: '#8b5cf6' },
  { name: 'Health', kind: 'expense', icon: 'i-lucide-heart-pulse', color: '#ef4444' },
  { name: 'Kids', kind: 'expense', icon: 'i-lucide-baby', color: '#ec4899' },
  { name: 'Entertainment', kind: 'expense', icon: 'i-lucide-clapperboard', color: '#a855f7' },
  { name: 'Shopping', kind: 'expense', icon: 'i-lucide-shopping-bag', color: '#f59e0b' },
  { name: 'Subscriptions', kind: 'expense', icon: 'i-lucide-repeat', color: '#14b8a6' },
  { name: 'Insurance', kind: 'expense', icon: 'i-lucide-shield', color: '#64748b' },
  { name: 'Savings', kind: 'expense', icon: 'i-lucide-piggy-bank', color: '#22c55e' },
  { name: 'Fees', kind: 'expense', icon: 'i-lucide-receipt', color: '#94a3b8' },
  { name: 'Other', kind: 'expense', icon: 'i-lucide-circle-ellipsis', color: '#94a3b8' },
  { name: 'Paycheck', kind: 'income', icon: 'i-lucide-banknote', color: '#16a34a' },
  { name: 'Other income', kind: 'income', icon: 'i-lucide-hand-coins', color: '#22c55e' },
  { name: 'Transfer', kind: 'transfer', icon: 'i-lucide-arrow-left-right', color: '#64748b' },
]

/** Idempotent: safe to call on every finance page load. */
export function seedCategories(db: Db, householdId: string): void {
  const existing = db.select({ id: financeCategories.id }).from(financeCategories)
    .where(eq(financeCategories.householdId, householdId)).limit(1).get()
  if (existing) return

  db.insert(financeCategories).values(
    SEED.map((c, i) => ({ householdId, ...c, sortOrder: i, isSystem: true })),
  ).run()
}

export function listCategories(db: Db, householdId: string, includeArchived = false) {
  const rows = db.select().from(financeCategories)
    .where(includeArchived
      ? eq(financeCategories.householdId, householdId)
      : and(eq(financeCategories.householdId, householdId), isNull(financeCategories.archivedAt)))
    .orderBy(asc(financeCategories.sortOrder), asc(financeCategories.name))
    .all()
  return rows.map(r => ({ ...r, archivedAt: r.archivedAt?.getTime() ?? null, createdAt: r.createdAt.getTime() }))
}

export function createCategory(db: Db, householdId: string, input: {
  name: string
  kind?: 'expense' | 'income' | 'transfer'
  icon?: string | null
  color?: string | null
  parentId?: string | null
}) {
  const max = db.select({ sortOrder: financeCategories.sortOrder }).from(financeCategories)
    .where(eq(financeCategories.householdId, householdId)).all()
    .reduce((acc, r) => Math.max(acc, r.sortOrder), -1)

  return db.insert(financeCategories).values({
    householdId,
    name: input.name,
    kind: input.kind ?? 'expense',
    icon: input.icon ?? null,
    color: input.color ?? null,
    parentId: input.parentId ?? null,
    sortOrder: max + 1,
  }).returning().get()
}

export function patchCategory(db: Db, householdId: string, id: string, patch: Record<string, unknown>) {
  const row = db.select().from(financeCategories)
    .where(and(eq(financeCategories.id, id), eq(financeCategories.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Category not found' })

  const { archived, ...rest } = patch as { archived?: boolean }
  const values: Record<string, unknown> = { ...rest }
  if (archived !== undefined) values.archivedAt = archived ? new Date() : null

  return db.update(financeCategories).set(values).where(eq(financeCategories.id, id)).returning().get()
}

/**
 * Archives rather than deletes when transactions reference it. Losing the
 * category on a year of history to tidy a list is not a trade anyone wants,
 * and the FK is `set null` so a hard delete would silently do exactly that.
 */
export function deleteCategory(db: Db, householdId: string, id: string): { archived: boolean } {
  const row = db.select().from(financeCategories)
    .where(and(eq(financeCategories.id, id), eq(financeCategories.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Category not found' })

  const used = db.select({ id: financeTransactions.id }).from(financeTransactions)
    .where(eq(financeTransactions.categoryId, id)).limit(1).get()
  if (used) {
    db.update(financeCategories).set({ archivedAt: new Date() }).where(eq(financeCategories.id, id)).run()
    return { archived: true }
  }
  db.delete(financeCategories).where(eq(financeCategories.id, id)).run()
  return { archived: false }
}
