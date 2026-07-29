import { describe, expect, it } from 'vitest'
import {
  appendDigit, backspace, canSubmit, PIN_MAX_LENGTH, PIN_MIN_LENGTH,
} from '../../shared/utils/pinPad'

describe('appendDigit', () => {
  it('appends a digit', () => {
    expect(appendDigit('48', '2')).toBe('482')
  })

  it('ignores anything that is not a single digit', () => {
    // The pad only emits digits, but a stray physical keypress must not slip a
    // letter into a buffer the dots claim is numeric.
    for (const key of ['a', 'Enter', '', '12', ' ', '-']) {
      expect(appendDigit('48', key)).toBe('48')
    }
  })

  it('refuses to overflow the max length', () => {
    const full = '1'.repeat(PIN_MAX_LENGTH)
    expect(appendDigit(full, '9')).toBe(full)
    expect(appendDigit('1'.repeat(PIN_MAX_LENGTH - 1), '9')).toHaveLength(PIN_MAX_LENGTH)
  })
})

describe('backspace', () => {
  it('drops the last character', () => {
    expect(backspace('4821')).toBe('482')
  })

  it('is a no-op on an empty buffer', () => {
    expect(backspace('')).toBe('')
  })
})

describe('canSubmit', () => {
  it('needs the server minimum', () => {
    expect(canSubmit('12345')).toBe(false)
    expect(canSubmit('123456')).toBe(true)
    expect(canSubmit('4821934')).toBe(true)
  })

  it('matches zPin’s lower bound', () => {
    expect(PIN_MIN_LENGTH).toBe(6)
    expect(canSubmit('x'.repeat(PIN_MIN_LENGTH))).toBe(true)
  })
})

describe('bounds match the server', () => {
  it('mirrors zPin, so the pad can never build a PIN the server rejects', () => {
    // Both come from shared/schemas/finance.ts — a drift here would let someone
    // enter a PIN the pad accepts and the API 400s.
    expect(PIN_MIN_LENGTH).toBe(6)
    expect(PIN_MAX_LENGTH).toBe(64)
  })
})
