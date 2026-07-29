import { describe, expect, it } from 'vitest'
import {
  financeBillPatchSchema, financeCategoryPatchSchema, financeGoalPatchSchema,
  financeRulePatchSchema,
} from '../../shared/schemas/finance'

/**
 * A PATCH must carry ONLY what the caller sent.
 *
 * `createSchema.partial()` does not do that: in zod 4 a partial'd field is
 * `ZodOptional<ZodDefault<T>>` and the default still fires for an absent key,
 * so parsing `{ enabled: false }` also yields matchField/matchType/priority.
 * Every service here does `db.update(...).set(patch)`, so those defaults get
 * WRITTEN — flipping a rule's switch used to silently rewrite the rule.
 */

describe('patch schemas never inject defaults', () => {
  it('a rule toggle carries only `enabled`', () => {
    // The exact body FinanceRules.vue sends when you flip the switch.
    expect(financeRulePatchSchema.parse({ enabled: false })).toEqual({ enabled: false })
  })

  it('renaming a category does not reset its kind', () => {
    // kind defaults to 'expense'; an income category must survive a rename.
    expect(financeCategoryPatchSchema.parse({ name: 'Paycheck' })).toEqual({ name: 'Paycheck' })
  })

  it('archiving a bill does not reset kind or autoPay', () => {
    expect(financeBillPatchSchema.parse({ archived: true })).toEqual({ archived: true })
  })

  it('goal patches stay minimal too', () => {
    expect(Object.keys(financeGoalPatchSchema.parse({ name: 'Holiday' }))).toEqual(['name'])
  })

  it('still validates the fields that ARE sent', () => {
    expect(() => financeRulePatchSchema.parse({ matchValue: '' })).toThrow()
    expect(() => financeRulePatchSchema.parse({ matchField: 'nonsense' })).toThrow()
    expect(() => financeCategoryPatchSchema.parse({ name: '' })).toThrow()
  })

  it('still accepts a full patch, and an explicit null on a nullish field', () => {
    expect(financeRulePatchSchema.parse({ matchField: 'payee', matchType: 'equals', matchValue: 'SHELL' }))
      .toEqual({ matchField: 'payee', matchType: 'equals', matchValue: 'SHELL' })
    // `.nullish()` fields must keep accepting null — that's a value, not an absence.
    expect(financeRulePatchSchema.parse({ setPayee: null })).toEqual({ setPayee: null })
    expect(financeCategoryPatchSchema.parse({ color: null })).toEqual({ color: null })
  })
})
