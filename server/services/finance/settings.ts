import { currencyExponent } from '#shared/utils/money'
import type { households } from '../../db/schema'

/**
 * The household's display currency. Settings is a JSON column that older rows
 * were never migrated for (the CLAUDE.md convention), so every read supplies
 * its own default rather than assuming the key exists.
 *
 * This is a DISPLAY default only. Each account carries its own currency —
 * SimpleFIN reports per-account — and totals are grouped by currency rather
 * than converted, because there is no FX rate anywhere in this app.
 */
export function financeCurrency(household: typeof households.$inferSelect) {
  const currency = household.settings?.finance?.currency ?? 'USD'
  return {
    currency,
    currencyExponent: currencyExponent(currency),
    forecastDays: household.settings?.finance?.forecastDays ?? 90,
    forecastEverydaySpend: household.settings?.finance?.forecastEverydaySpend ?? true,
  }
}
