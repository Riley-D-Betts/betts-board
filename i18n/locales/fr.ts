import auth from './fr/auth.json'
import calendar from './fr/calendar.json'
import chores from './fr/chores.json'
import common from './fr/common.json'
import feedback from './fr/feedback.json'
import finance from './fr/finance.json'
import meals from './fr/meals.json'
import pantry from './fr/pantry.json'
import photos from './fr/photos.json'
import recipes from './fr/recipes.json'
import rewards from './fr/rewards.json'
import settings from './fr/settings.json'
import shopping from './fr/shopping.json'
import tv from './fr/tv.json'
import wishlists from './fr/wishlists.json'

/**
 * French. Mirrors en.ts file for file — tests/unit/i18n.spec.ts asserts the
 * key set is identical to English and that placeholders and plural branches
 * survived translation. Note French counts zero as singular; the rule for that
 * lives in i18n/i18n.config.ts.
 */
export default defineI18nLocale(() => ({
  auth,
  calendar,
  chores,
  common,
  feedback,
  finance,
  meals,
  pantry,
  photos,
  recipes,
  rewards,
  settings,
  shopping,
  tv,
  wishlists,
}))
