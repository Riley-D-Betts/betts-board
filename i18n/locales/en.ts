import auth from './en/auth.json'
import calendar from './en/calendar.json'
import chores from './en/chores.json'
import common from './en/common.json'
import feedback from './en/feedback.json'
import finance from './en/finance.json'
import meals from './en/meals.json'
import pantry from './en/pantry.json'
import photos from './en/photos.json'
import recipes from './en/recipes.json'
import rewards from './en/rewards.json'
import settings from './en/settings.json'
import shopping from './en/shopping.json'
import tv from './en/tv.json'
import wishlists from './en/wishlists.json'

/**
 * One file per feature slice, merged here — matching how the rest of the
 * codebase is organised, and so two features being translated at once don't
 * collide in a single 1000-key file.
 *
 * Adding a language: copy `en/` to e.g. `de/`, translate, add a sibling
 * `de.ts`, and add one entry to LOCALE_DEFS in shared/schemas/locales.ts.
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
