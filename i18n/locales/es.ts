import auth from './es/auth.json'
import calendar from './es/calendar.json'
import chores from './es/chores.json'
import common from './es/common.json'
import feedback from './es/feedback.json'
import finance from './es/finance.json'
import meals from './es/meals.json'
import pantry from './es/pantry.json'
import photos from './es/photos.json'
import recipes from './es/recipes.json'
import rewards from './es/rewards.json'
import settings from './es/settings.json'
import shopping from './es/shopping.json'
import tv from './es/tv.json'
import wishlists from './es/wishlists.json'

/**
 * Spanish. Mirrors en.ts file for file — tests/unit/i18n.spec.ts asserts the
 * key set is identical to English and that placeholders and plural branches
 * survived translation.
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
