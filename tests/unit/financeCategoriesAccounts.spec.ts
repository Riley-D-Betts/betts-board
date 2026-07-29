import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeAccounts, financeCategories, financeConnections,
  financeTransactions, households, profiles,
} from '../../server/db/schema'
import { installNitroGlobals } from '../support/nitroGlobals'

installNitroGlobals()

const { createAccount, deleteAccount, listAccounts }
  = await import('../../server/services/finance/accounts')
const { createCategory, patchCategory, listCategories }
  = await import('../../server/services/finance/categories')
const { createTransaction } = await import('../../server/services/finance/transactions')

let db: Db
let householdId: string
let profileId: string

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  for (const table of [financeTransactions, financeCategories, financeAccounts, financeConnections])
    db.delete(table).run()
  db.delete(profiles).run()
  db.delete(households).run()

  householdId = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get().id
  profileId = db.insert(profiles)
    .values({ householdId, name: 'Dad', color: '#112233', role: 'admin' })
    .returning().get().id
})

// ── Adding a category ───────────────────────────────────────────────────────

describe('creating a category', () => {
  it('defaults kind to expense and appends after existing categories', () => {
    const first = createCategory(db, householdId, { name: 'Coffee' })
    expect(first.kind).toBe('expense')
    expect(first.color).toBeNull()

    const second = createCategory(db, householdId, { name: 'Hobbies', color: '#8b5cf6' })
    // sortOrder is max+1, so a fresh household starts at 0 then 1 — the new
    // category lands at the end of the list the UI renders.
    expect(second.sortOrder).toBe(first.sortOrder + 1)
    expect(second.color).toBe('#8b5cf6')
  })

  it('keeps an explicit income/transfer kind', () => {
    expect(createCategory(db, householdId, { name: 'Bonus', kind: 'income' }).kind).toBe('income')
    expect(createCategory(db, householdId, { name: 'Move money', kind: 'transfer' }).kind).toBe('transfer')
  })

  it('shows up in the (unarchived) list a picker reads', () => {
    createCategory(db, householdId, { name: 'Coffee' })
    expect(listCategories(db, householdId).map(c => c.name)).toContain('Coffee')
  })
})

// ── Editing a category ──────────────────────────────────────────────────────

describe('patching a category', () => {
  it('renames and recolours in place', () => {
    const cat = createCategory(db, householdId, { name: 'Coffee', color: '#16a34a' })
    const patched = patchCategory(db, householdId, cat.id, { name: 'Espresso', color: '#ef4444' })
    expect(patched.name).toBe('Espresso')
    expect(patched.color).toBe('#ef4444')
  })

  it('clearing the colour is honoured, not treated as "leave unchanged"', () => {
    const cat = createCategory(db, householdId, { name: 'Coffee', color: '#16a34a' })
    expect(patchCategory(db, householdId, cat.id, { color: null }).color).toBeNull()
  })

  it('archiving removes it from the default list but keeps the row', () => {
    const cat = createCategory(db, householdId, { name: 'Coffee' })
    patchCategory(db, householdId, cat.id, { archived: true })
    expect(listCategories(db, householdId).some(c => c.id === cat.id)).toBe(false)
    expect(listCategories(db, householdId, true).some(c => c.id === cat.id)).toBe(true)
  })

  it('refuses to touch a category from another household', () => {
    const other = db.insert(households).values({
      name: 'Other', passwordHash: 'x', timezone: 'UTC', icsToken: 'tok2', settings: defaultHouseholdSettings,
    }).returning().get().id
    const cat = createCategory(db, other, { name: 'Theirs' })
    expect(() => patchCategory(db, householdId, cat.id, { name: 'Mine' })).toThrow()
  })
})

// ── Removing an account ─────────────────────────────────────────────────────

describe('removing an account', () => {
  it('deletes a manual account and cascades its transactions', () => {
    const account = createAccount(db, householdId, { name: 'Checking', type: 'checking', currency: 'USD' })
    const category = createCategory(db, householdId, { name: 'Groceries' })
    createTransaction(db, {
      householdId,
      profileId,
      input: {
        accountId: account.id,
        postedDate: '2026-07-10',
        description: 'Costco',
        amountMinor: -6040,
        categoryId: category.id,
      },
    })

    deleteAccount(db, householdId, account.id)

    expect(listAccounts(db, householdId).some(a => a.id === account.id)).toBe(false)
    // The FK is onDelete: 'cascade' — no orphaned rows point at a gone account.
    const orphans = db.select().from(financeTransactions)
      .where(eq(financeTransactions.accountId, account.id)).all()
    expect(orphans).toHaveLength(0)
  })

  it('refuses to delete a synced account — that is what disconnecting the bank is for', () => {
    const connectionId = db.insert(financeConnections).values({
      householdId, provider: 'simplefin', accessUrlEnc: 'x',
    }).returning().get().id
    const synced = db.insert(financeAccounts).values({
      householdId, connectionId, name: 'Bank checking', type: 'checking',
      currency: 'USD', currencyExponent: 2, balanceSource: 'bank', balanceMinor: 0,
    }).returning().get()

    expect(() => deleteAccount(db, householdId, synced.id)).toThrow(/bank connection/)
    // Still there — the refusal must not partially remove it.
    expect(listAccounts(db, householdId).some(a => a.id === synced.id)).toBe(true)
  })

  it('refuses to delete an account from another household', () => {
    const other = db.insert(households).values({
      name: 'Other', passwordHash: 'x', timezone: 'UTC', icsToken: 'tok2', settings: defaultHouseholdSettings,
    }).returning().get().id
    const account = createAccount(db, other, { name: 'Theirs', currency: 'USD' })
    expect(() => deleteAccount(db, householdId, account.id)).toThrow()
  })
})
