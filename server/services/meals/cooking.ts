import { and, eq, gte, isNotNull, lt } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { CalendarOccurrence } from '#shared/schemas/events'
import {
  COOK_PADDING_MINUTES,
  DEFAULT_COOK_MINUTES,
  DEFAULT_MEAL_TIMES,
  type mealSlots,
} from '#shared/schemas/meals'
import type { Db } from '../../db/client'
import { mealPlanEntries, profiles, recipes } from '../../db/schema'

type MealSlot = typeof mealSlots[number]

export interface CookingOccurrencesArgs {
  householdId: string
  windowStartMs: number
  windowEndMs: number
  /** Household timezone: mealtimes are wall clocks on the entry's date here. */
  timezone: string
  /** Household settings override; missing slots fall back to DEFAULT_MEAL_TIMES. */
  mealTimes?: Partial<Record<MealSlot, string>>
}

/**
 * Synthesizes read-only "Cook: …" calendar blocks for meal-plan entries that
 * have a cook assigned. A block ENDS at the slot's mealtime on the entry's
 * date and STARTS recipe-total-time + COOK_PADDING_MINUTES earlier, so it
 * tells the cook when to start. Filtered to [windowStartMs, windowEndMs) by
 * the START instant.
 */
export function getCookingOccurrences(db: Db, args: CookingOccurrencesArgs): CalendarOccurrence[] {
  const { householdId, windowStartMs, windowEndMs, timezone } = args

  // The window's date range in household wall time, same approach as
  // expand.ts — plus one extra day at the end: a block can START inside the
  // window while its mealtime lands on the first excluded date.
  const windowStartDate = DateTime.fromMillis(windowStartMs, { zone: timezone }).toISODate()!
  const windowEndDateExcl = DateTime.fromMillis(windowEndMs - 1, { zone: timezone })
    .plus({ days: 2 }).toISODate()!

  const rows = db.select({
    entry: mealPlanEntries,
    cook: { id: profiles.id, name: profiles.name, color: profiles.color, archivedAt: profiles.archivedAt },
    recipe: {
      id: recipes.id,
      title: recipes.title,
      prepMinutes: recipes.prepMinutes,
      cookMinutes: recipes.cookMinutes,
      totalMinutes: recipes.totalMinutes,
    },
  }).from(mealPlanEntries)
    .innerJoin(profiles, eq(profiles.id, mealPlanEntries.cookProfileId))
    .leftJoin(recipes, eq(recipes.id, mealPlanEntries.recipeId))
    .where(and(
      eq(mealPlanEntries.householdId, householdId),
      isNotNull(mealPlanEntries.cookProfileId),
      gte(mealPlanEntries.date, windowStartDate),
      lt(mealPlanEntries.date, windowEndDateExcl),
    ))
    .all()

  const out: CalendarOccurrence[] = []

  for (const { entry, cook, recipe } of rows) {
    if (cook.archivedAt) continue

    const wallTime = args.mealTimes?.[entry.slot] ?? DEFAULT_MEAL_TIMES[entry.slot]
    const end = DateTime.fromISO(`${entry.date}T${wallTime}`, { zone: timezone })
    if (!end.isValid) continue
    const endMs = end.toMillis()

    const baseMinutes = recipe
      ? recipe.totalMinutes ?? (((recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0)) || DEFAULT_COOK_MINUTES)
      : DEFAULT_COOK_MINUTES
    const startMs = endMs - (baseMinutes + COOK_PADDING_MINUTES) * 60_000
    if (startMs < windowStartMs || startMs >= windowEndMs) continue

    out.push({
      occurrenceId: `meal:${entry.id}`,
      eventId: entry.id,
      kind: 'meal',
      title: `Cook: ${recipe?.title ?? entry.freeText}`,
      isAllDay: false,
      start: startMs,
      end: endMs,
      color: cook.color,
      attendees: [{ profileId: cook.id, color: cook.color, name: cook.name }],
      readonly: true,
      isException: false,
      hasRecurrence: false,
      mealEntryId: entry.id,
      recipeId: recipe?.id ?? null,
    })
  }

  return out
}
