import { currencyExponent } from '#shared/utils/money'

/**
 * Money formatting for DISPLAY.
 *
 * Same discipline as useDateFormat: this is the only place a locale touches an
 * amount. Values headed anywhere machine-readable — a number input, an RRULE,
 * an export — stay as integer minor units and never round-trip through a
 * localized string. Under `de-DE` that string is "1.234,56"; under `ar-SA` it
 * uses Arabic-Indic digits, and parsing it back gives nonsense.
 */
export function useMoney() {
  const { locale } = useI18n()

  const formatters = new Map<string, Intl.NumberFormat>()
  function formatter(currency: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
    const key = `${locale.value}|${currency}|${JSON.stringify(options)}`
    let cached = formatters.get(key)
    if (!cached) {
      const exponent = currencyExponent(currency)
      // A non-ISO code (SimpleFIN permits a URL for non-ISO assets) would make
      // Intl throw, which must not take out the whole page.
      const isIso = /^[A-Za-z]{3}$/.test(currency)
      cached = new Intl.NumberFormat(locale.value, isIso
        ? { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: exponent, maximumFractionDigits: exponent, ...options }
        : { style: 'decimal', minimumFractionDigits: exponent, maximumFractionDigits: exponent, ...options })
      formatters.set(key, cached)
    }
    return cached
  }

  /** "$1,234.56" — the default for balances and amounts. */
  function money(minor: number | null | undefined, currency = 'USD'): string {
    if (minor == null) return '—'
    const exponent = currencyExponent(currency)
    const formatted = formatter(currency).format(minor / 10 ** exponent)
    return /^[A-Za-z]{3}$/.test(currency) ? formatted : `${formatted} ${currency}`
  }

  /** Drops the decimals for headline figures, where cents are noise. */
  function moneyShort(minor: number | null | undefined, currency = 'USD'): string {
    if (minor == null) return '—'
    const exponent = currencyExponent(currency)
    return formatter(currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      .format(minor / 10 ** exponent)
  }

  /** "+$25.00" — for a ledger, where the sign carries the meaning. */
  function moneySigned(minor: number, currency = 'USD'): string {
    return `${minor > 0 ? '+' : ''}${money(minor, currency)}`
  }

  /**
   * Minor units → the value for a numeric `<input>`. Deliberately NOT
   * localized: an input's value must round-trip exactly.
   */
  function toInput(minor: number | null | undefined, currency = 'USD'): string {
    if (minor == null) return ''
    const exponent = currencyExponent(currency)
    return (minor / 10 ** exponent).toFixed(exponent)
  }

  /**
   * A number input's value → minor units, via string arithmetic rather than
   * `Math.round(x * 100)` — 1.005 * 100 is 100.49999999999999 in IEEE 754,
   * which is how a ledger quietly loses a cent.
   */
  function fromInput(value: string | number | null | undefined, currency = 'USD'): number | null {
    if (value === '' || value == null) return null
    const exponent = currencyExponent(currency)
    const text = typeof value === 'number' ? value.toFixed(exponent + 2) : String(value).trim()
    const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
    if (!match || (!match[2] && !match[3])) return null

    const [, sign, whole = '', fraction = ''] = match
    const kept = fraction.slice(0, exponent).padEnd(exponent, '0')
    let minor = Number(`${whole || '0'}${kept}`)
    if ((fraction.charCodeAt(exponent) - 48) >= 5) minor += 1
    if (!Number.isSafeInteger(minor)) return null
    return sign === '-' ? -minor : minor
  }

  /** "62%" for a budget bar. */
  function percent(value: number | null | undefined): string {
    if (value == null) return '—'
    return new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }).format(value)
  }

  return { money, moneyShort, moneySigned, toInput, fromInput, percent }
}
