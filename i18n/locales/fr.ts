import calendar from './fr/calendar.json'
import chores from './fr/chores.json'
import common from './fr/common.json'
import finance from './fr/finance.json'
import recipes from './fr/recipes.json'
import settings from './fr/settings.json'
import shopping from './fr/shopping.json'
import wishlists from './fr/wishlists.json'

/**
 * French. Mirrors en.ts file for file — the key set is asserted identical to
 * English by tests/unit/i18n.spec.ts, which also checks that placeholders and
 * plural branches survived translation.
 */
export default defineI18nLocale(() => ({
  calendar,
  chores,
  common,
  finance,
  recipes,
  settings,
  shopping,
  wishlists,
}))
