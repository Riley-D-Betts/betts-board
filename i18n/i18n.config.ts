/**
 * vue-i18n runtime options. Only pluralisation lives here — the messages
 * themselves come from the per-locale files listed in nuxt.config.
 *
 * Why this file has to exist at all: vue-i18n's default rule for a two-branch
 * message is `n === 1 ? singular : plural`, which is right for English and
 * Spanish and WRONG for French. French takes the singular for zero as well —
 * "0 jour", "0 tâche" — and a board that says "0 jours" reads, to a French
 * family, exactly like a machine translation.
 *
 * The count of branches per message is asserted identical across locales by
 * tests/unit/i18n.spec.ts, so a translator cannot silently add a third form
 * that these rules would never select.
 */
export default defineI18nConfig(() => ({
  legacy: false,
  pluralRules: {
    /** 0 and 1 are both singular; everything else is plural. */
    fr: (choice: number, choicesLength: number): number => {
      if (choicesLength < 2) return 0
      return choice <= 1 ? 0 : 1
    },
  },
}))
