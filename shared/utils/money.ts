/**
 * Money is stored as integer minor units (cents) plus an ISO currency code.
 * Never a float: 0.1 + 0.2 is not 0.3, and a balance that drifts by a cent a
 * month is a bug nobody can find later.
 *
 * SimpleFIN sends amounts as decimal *strings* ("100.23", "-33293.43"), so the
 * parser here is string-based — it never goes through parseFloat.
 */

/** Currencies whose minor unit isn't 1/100. Everything else assumes 2 digits. */
const EXPONENTS: Record<string, number> = {
  // Zero-decimal
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, XAF: 0, XOF: 0, XPF: 0,
  // Three-decimal
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
}

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2
}

/**
 * Parses a decimal string into integer minor units, half-up on the sign's
 * magnitude. Throws on anything that isn't a plain decimal number — a silent
 * 0 here would look like a real balance.
 */
export function parseDecimalToMinor(value: string, currency = 'USD'): number {
  const trimmed = value.trim()
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(trimmed)
  if (!match || (!match[2] && !match[3])) {
    throw new Error(`Not a decimal amount: ${JSON.stringify(value)}`)
  }

  const [, sign, whole = '', fraction = ''] = match
  const exponent = currencyExponent(currency)

  // Pad or round the fraction to the currency's precision, entirely in strings.
  const kept = fraction.slice(0, exponent).padEnd(exponent, '0')
  const nextDigit = fraction.charCodeAt(exponent) - 48 // NaN when absent

  let minor = BigInt(`${whole || '0'}${kept || ''}`)
  if (nextDigit >= 5) minor += 1n // half-up on magnitude, sign applied after

  const signed = sign === '-' ? -minor : minor
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`Amount out of safe range: ${value}`)
  }
  return Number(signed)
}

/** Minor units back to a plain decimal string — for exports, not display. */
export function formatMinorAsDecimal(minor: number, currency = 'USD'): string {
  const exponent = currencyExponent(currency)
  const negative = minor < 0
  const digits = Math.abs(minor).toString().padStart(exponent + 1, '0')
  const whole = digits.slice(0, digits.length - exponent) || '0'
  const fraction = exponent ? `.${digits.slice(digits.length - exponent)}` : ''
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/** Epoch *seconds* (what SimpleFIN sends) to epoch ms. */
export function secondsToDate(seconds: number): Date {
  return new Date(seconds * 1000)
}
