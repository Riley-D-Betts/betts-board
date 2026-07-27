import { describe, expect, it } from 'vitest'
import { currencyExponent, formatMinorAsDecimal, parseDecimalToMinor, secondsToDate } from '#shared/utils/money'

describe('parseDecimalToMinor', () => {
  it.each([
    ['100.23', 10023],
    ['0.01', 1],
    ['0', 0],
    ['0.00', 0],
    ['5', 500],
    ['5.', 500],
    ['.5', 50],
    ['1234567.89', 123456789],
    ['+42.50', 4250],
  ])('%s -> %d', (input, expected) => {
    expect(parseDecimalToMinor(input)).toBe(expected)
  })

  it('handles negatives, which is most transactions', () => {
    expect(parseDecimalToMinor('-33293.43')).toBe(-3329343)
    expect(parseDecimalToMinor('-0.01')).toBe(-1)
  })

  it('rounds half-up on magnitude rather than truncating', () => {
    expect(parseDecimalToMinor('1.005')).toBe(101)
    expect(parseDecimalToMinor('1.004')).toBe(100)
    expect(parseDecimalToMinor('-1.005')).toBe(-101)
  })

  it('does not lose precision the way a float would', () => {
    // 1.005 * 100 is 100.49999999999999 in IEEE 754 — the classic silent bug.
    expect(Math.round(1.005 * 100)).toBe(100)
    expect(parseDecimalToMinor('1.005')).toBe(101)

    // A large balance stays exact.
    expect(parseDecimalToMinor('8675309.99')).toBe(867530999)
    // 0.1 + 0.2 territory
    expect(parseDecimalToMinor('0.1') + parseDecimalToMinor('0.2')).toBe(30)
  })

  it('respects currencies that are not two-decimal', () => {
    expect(parseDecimalToMinor('1000', 'JPY')).toBe(1000)
    expect(parseDecimalToMinor('1000.4', 'JPY')).toBe(1000)
    expect(parseDecimalToMinor('1000.5', 'JPY')).toBe(1001)
    expect(parseDecimalToMinor('12.345', 'KWD')).toBe(12345)
    expect(parseDecimalToMinor('12.3456', 'KWD')).toBe(12346)
  })

  it.each([
    ['', 'empty'],
    ['abc', 'letters'],
    ['1,234.56', 'thousands separator'],
    ['$10.00', 'currency symbol'],
    ['1.2.3', 'two points'],
    ['--5', 'double sign'],
    ['1e5', 'exponent notation'],
    ['  ', 'whitespace only'],
  ])('rejects %j (%s) rather than silently returning 0', (input) => {
    expect(() => parseDecimalToMinor(input)).toThrow()
  })

  it('rejects amounts beyond safe integer range', () => {
    expect(() => parseDecimalToMinor('999999999999999999999.99')).toThrow(/safe range/)
  })
})

describe('formatMinorAsDecimal', () => {
  it.each([
    [10023, 'USD', '100.23'],
    [1, 'USD', '0.01'],
    [0, 'USD', '0.00'],
    [-3329343, 'USD', '-33293.43'],
    [1000, 'JPY', '1000'],
    [12345, 'KWD', '12.345'],
  ])('%d %s -> %s', (minor, currency, expected) => {
    expect(formatMinorAsDecimal(minor, currency)).toBe(expected)
  })

  it('round-trips with the parser', () => {
    for (const value of ['100.23', '-0.01', '0.00', '99999.99']) {
      expect(formatMinorAsDecimal(parseDecimalToMinor(value))).toBe(
        value.startsWith('+') ? value.slice(1) : value,
      )
    }
  })
})

describe('currencyExponent', () => {
  it('defaults to 2 and is case-insensitive', () => {
    expect(currencyExponent('USD')).toBe(2)
    expect(currencyExponent('gbp')).toBe(2)
    expect(currencyExponent('ZZZ')).toBe(2)
    expect(currencyExponent('jpy')).toBe(0)
  })
})

describe('secondsToDate', () => {
  it('treats SimpleFIN timestamps as seconds, not milliseconds', () => {
    // 978366153 is in the spec's own example — Jan 2001, not 1970.
    expect(secondsToDate(978366153).getUTCFullYear()).toBe(2001)
  })
})
