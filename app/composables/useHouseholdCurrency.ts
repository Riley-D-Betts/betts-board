/**
 * The household's money currency, for the forms that turn typed text into
 * minor units.
 *
 * This exists because `fromInput()` and `money()` both need the currency to
 * know the exponent, and defaulting to USD is not harmless: a yen household
 * typing 1000 would get 100000 minor units — a hundredfold error, stored, with
 * nothing downstream able to tell it was wrong.
 */
export function useHouseholdCurrency() {
  const { state } = useBoardState()
  return computed(() => state.value?.settings?.finance?.currency ?? 'USD')
}
