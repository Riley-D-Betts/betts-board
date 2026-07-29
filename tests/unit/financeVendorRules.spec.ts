import { describe, expect, it } from 'vitest'
import { applyRules, matchesRule, type RuleRow } from '../../server/services/finance/rules'

/**
 * Vendor mapping — "anything paid to McDonald's is Dining out".
 *
 * These are the semantics the vendor-rule UI leans on: case-insensitive
 * matching on the payee, a store-number suffix still matching, and the
 * first rule by priority winning so a specific rule can sit above a broad one.
 */

const DINING = 'cat-dining'
const GROCERIES = 'cat-groceries'

function rule(over: Partial<RuleRow> = {}): RuleRow {
  return {
    id: 'r1',
    householdId: 'hh',
    priority: 0,
    matchField: 'payee',
    matchType: 'contains',
    matchValue: 'McDonald',
    accountId: null,
    setCategoryId: DINING,
    setPayee: null,
    enabled: true,
    createdAt: new Date(),
    ...over,
  } as RuleRow
}

const txn = (over: Partial<{ description: string, payee: string | null, memo: string | null, accountId: string }> = {}) => ({
  description: 'CARD PURCHASE',
  payee: "MCDONALD'S #4821",
  memo: null,
  accountId: 'acc-1',
  ...over,
})

describe('matching a vendor', () => {
  it('matches case-insensitively with a store number attached', () => {
    expect(matchesRule(rule(), txn())).toBe(true)
  })

  it('does not match a different vendor', () => {
    expect(matchesRule(rule(), txn({ payee: 'SAFEWAY #22' }))).toBe(false)
  })

  it('falls to no-match when the matched field is empty rather than matching everything', () => {
    // A rule on `payee` must not fire for a transaction with no payee — that
    // would file every unlabelled charge as Dining out.
    expect(matchesRule(rule(), txn({ payee: null }))).toBe(false)
  })

  it('honours startsWith and equals', () => {
    expect(matchesRule(rule({ matchType: 'startsWith', matchValue: 'MCDON' }), txn())).toBe(true)
    expect(matchesRule(rule({ matchType: 'startsWith', matchValue: '4821' }), txn())).toBe(false)
    expect(matchesRule(rule({ matchType: 'equals', matchValue: "mcdonald's #4821" }), txn())).toBe(true)
    expect(matchesRule(rule({ matchType: 'equals', matchValue: 'McDonald' }), txn())).toBe(false)
  })

  it('can be pinned to one account', () => {
    expect(matchesRule(rule({ accountId: 'acc-1' }), txn())).toBe(true)
    expect(matchesRule(rule({ accountId: 'acc-2' }), txn())).toBe(false)
  })

  it('matches on the description when that is the field chosen', () => {
    const r = rule({ matchField: 'description', matchValue: 'card purchase' })
    expect(matchesRule(r, txn())).toBe(true)
  })
})

describe('applying vendor rules', () => {
  it('files the transaction into the rule’s category', () => {
    expect(applyRules([rule()], txn())).toEqual({ categoryId: DINING })
  })

  it('skips a disabled rule', () => {
    expect(applyRules([rule({ enabled: false })], txn())).toBeNull()
  })

  it('first match wins, so a specific rule can sit above a broad one', () => {
    const specific = rule({ id: 'r-specific', matchValue: "McDonald's #4821", setCategoryId: DINING })
    const broad = rule({ id: 'r-broad', matchValue: 'MC', setCategoryId: GROCERIES })
    // listRules orders by priority, so the array order here is the real order.
    expect(applyRules([specific, broad], txn())?.categoryId).toBe(DINING)
    expect(applyRules([broad, specific], txn())?.categoryId).toBe(GROCERIES)
  })

  it('can tidy the payee as well as categorise', () => {
    expect(applyRules([rule({ setPayee: "McDonald's" })], txn()))
      .toEqual({ categoryId: DINING, payee: "McDonald's" })
  })

  it('returns null when nothing matches, leaving the transaction alone', () => {
    expect(applyRules([rule()], txn({ payee: 'SHELL' }))).toBeNull()
  })
})
