import { describe, expect, it } from 'vitest'
import { LAST_DAY, firstSemimonthlyOnOrAfter, isSemimonthly, semimonthlyRule } from '../../shared/utils/billCadence'

describe('semimonthlyRule', () => {
  it('builds a BYMONTHDAY rule from two days', () => {
    expect(semimonthlyRule(5, 20)).toBe('FREQ=MONTHLY;BYMONTHDAY=5,20')
  })

  it('orders the days ascending regardless of input order', () => {
    expect(semimonthlyRule(20, 5)).toBe('FREQ=MONTHLY;BYMONTHDAY=5,20')
  })

  it('puts the last day (-1) at the end, not first', () => {
    expect(semimonthlyRule(LAST_DAY, 15)).toBe('FREQ=MONTHLY;BYMONTHDAY=15,-1')
    expect(semimonthlyRule(15, LAST_DAY)).toBe('FREQ=MONTHLY;BYMONTHDAY=15,-1')
  })

  it('dedupes the same day picked twice', () => {
    expect(semimonthlyRule(10, 10)).toBe('FREQ=MONTHLY;BYMONTHDAY=10')
  })
})

describe('isSemimonthly', () => {
  it('is true for a two-day BYMONTHDAY rule', () => {
    expect(isSemimonthly('FREQ=MONTHLY;BYMONTHDAY=5,20')).toBe(true)
    expect(isSemimonthly('FREQ=MONTHLY;BYMONTHDAY=15,-1')).toBe(true)
  })

  it('is false for the plain preset rules and one-offs', () => {
    expect(isSemimonthly('FREQ=MONTHLY')).toBe(false)
    expect(isSemimonthly('FREQ=WEEKLY;INTERVAL=2')).toBe(false)
    expect(isSemimonthly('FREQ=MONTHLY;BYMONTHDAY=15')).toBe(false) // single day
    expect(isSemimonthly(null)).toBe(false)
    expect(isSemimonthly(undefined)).toBe(false)
  })
})

describe('firstSemimonthlyOnOrAfter', () => {
  it('returns the earlier day when both are still ahead this month', () => {
    expect(firstSemimonthlyOnOrAfter('2026-01-01', 5, 20)).toBe('2026-01-05')
  })

  it('returns the later day once the earlier has passed', () => {
    expect(firstSemimonthlyOnOrAfter('2026-01-10', 5, 20)).toBe('2026-01-20')
  })

  it('rolls into next month once both have passed', () => {
    expect(firstSemimonthlyOnOrAfter('2026-01-29', 5, 20)).toBe('2026-02-05')
  })

  it('resolves the last day of the month, honouring month length', () => {
    expect(firstSemimonthlyOnOrAfter('2026-02-16', 15, LAST_DAY)).toBe('2026-02-28')
    expect(firstSemimonthlyOnOrAfter('2026-01-16', 15, LAST_DAY)).toBe('2026-01-31')
  })
})
