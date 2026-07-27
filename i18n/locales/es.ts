import calendar from './es/calendar.json'
import chores from './es/chores.json'
import common from './es/common.json'
import finance from './es/finance.json'
import recipes from './es/recipes.json'
import settings from './es/settings.json'
import shopping from './es/shopping.json'
import wishlists from './es/wishlists.json'

/**
 * Spanish. Mirrors en.ts file for file — the key set is asserted identical to
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
