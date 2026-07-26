import chores from './en/chores.json'
import common from './en/common.json'
import recipes from './en/recipes.json'
import settings from './en/settings.json'
import shopping from './en/shopping.json'
import wishlists from './en/wishlists.json'

/**
 * One file per feature slice, merged here — matching how the rest of the
 * codebase is organised, and so two features being translated at once don't
 * collide in a single 500-key file.
 *
 * Adding a language: copy `en/` to e.g. `de/`, translate, add a sibling
 * `de.ts`, and add one entry to `i18n.locales` in nuxt.config.ts.
 */
export default defineI18nLocale(() => ({
  common,
  chores,
  wishlists,
  settings,
  shopping,
  recipes,
}))
