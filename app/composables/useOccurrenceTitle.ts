import type { CalendarOccurrence } from '#shared/schemas/events'

/**
 * The visible label for a calendar occurrence, in the board's language.
 *
 * Cooking blocks are synthesized by the meal planner and have no title of
 * their own — `/api/calendar` returns the dish and marks the occurrence
 * `kind: 'meal'`, and the "Cooking — …" wrapper is composed here. Doing it on
 * the client is the whole point: the server has no idea which language the
 * wall display is showing, and a label baked in there once meant every screen
 * had to strip an English prefix back off with a regex.
 *
 * Six screens render occurrence titles (month, week, chips, the detail modal,
 * the dashboard tile, the TV board and the slideshow overlay) — all of them go
 * through this so none of them can drift.
 */
export function useOccurrenceTitle() {
  const { t } = useI18n()

  function occurrenceTitle(occ: Pick<CalendarOccurrence, 'kind' | 'title'>): string {
    if (occ.kind === 'meal') return t('calendar.cookingTitle', { title: occ.title })
    return occ.title
  }

  return { occurrenceTitle }
}
