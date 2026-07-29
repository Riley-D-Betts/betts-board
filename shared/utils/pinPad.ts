/**
 * PIN buffer arithmetic for the on-screen keypad.
 *
 * Pure and framework-free so the fiddly parts — the length ceiling, never
 * going negative, what counts as submittable — are unit-tested rather than
 * buried in a component.
 *
 * A stored PIN is a 6–64 character STRING (`zPin` in shared/schemas/finance.ts),
 * not a fixed-length number, which is why the pad can't auto-submit at N digits
 * and why a keyboard fallback has to stay reachable: a PIN set before the pad
 * existed may well contain letters.
 */

import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../schemas/finance'

export { PIN_MAX_LENGTH, PIN_MIN_LENGTH }

/** Append one keypress, ignoring anything that isn't a digit or would overflow. */
export function appendDigit(buffer: string, digit: string, max = PIN_MAX_LENGTH): string {
  if (!/^\d$/.test(digit)) return buffer
  if (buffer.length >= max) return buffer
  return buffer + digit
}

/** Drop the last character. A no-op on an empty buffer rather than an error. */
export function backspace(buffer: string): string {
  return buffer.slice(0, -1)
}

/** Long enough for the server to accept it — drives the submit button. */
export function canSubmit(buffer: string, min = PIN_MIN_LENGTH): boolean {
  return buffer.length >= min
}
