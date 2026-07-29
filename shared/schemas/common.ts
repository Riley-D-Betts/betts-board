import { z } from 'zod'

/** YYYY-MM-DD local calendar date — never timezone-converted. */
export const zDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

/** HH:MM 24h wall time. */
export const zTimeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')

export const zHexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb')

/** UTC instant as epoch milliseconds. */
export const zEpochMs = z.number().int().nonnegative()

export const zId = z.string().min(1)

/**
 * An http(s) URL, for anything that will be put in an `href` or fetched.
 *
 * `z.string().url()` is NOT enough on its own: it accepts `javascript:` and
 * `data:text/html,…`, both of which execute when a stored value is rendered
 * into a link. Anyone in the household can save a wish-list item or a recipe
 * source, so that is stored XSS on the board's own origin, with the session
 * cookie, triggered by whoever clicks it next.
 *
 * The same rule protects the server: every URL the board FETCHES also comes
 * through here, so `file://` and `gopher://` never reach fetch().
 */
export const zHttpUrl = z.string().trim().url().refine(
  (value) => {
    try {
      const scheme = new URL(value).protocol
      return scheme === 'http:' || scheme === 'https:'
    }
    catch {
      return false
    }
  },
  'expected an http:// or https:// link',
)

/**
 * Frequencies the board can safely expand.
 *
 * SECONDLY and MINUTELY are deliberately absent. Nothing in the UI offers
 * them, and a single "every second" rule expanded over a year is tens of
 * millions of occurrences — enough to wedge the one container the whole
 * household shares. An ICS feed publisher can plant one remotely, so this is
 * not only about what a family member might type.
 */
export const RRULE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const

/** Bare RRULE body, e.g. "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE" (no DTSTART line). */
export const zRRule = z.string()
  .regex(/^FREQ=/, 'expected an RRULE body starting with FREQ=')
  .refine(
    value => RRULE_FREQUENCIES.includes(
      (/^FREQ=([A-Z]+)/i.exec(value)?.[1] ?? '').toUpperCase() as typeof RRULE_FREQUENCIES[number],
    ),
    `FREQ must be one of ${RRULE_FREQUENCIES.join(', ')}`,
  )
  // INTERVAL=0 is not a valid rule and makes rrule iterate without advancing.
  .refine(value => !/;INTERVAL=0*(?:;|$)/i.test(value), 'INTERVAL must be at least 1')

/**
 * A single typed-or-picked emoji.
 *
 * The length cap is only a cheap size guard — the real rule is the grapheme
 * count. A `.max(8)` character cap (the old rule) rejected 👨‍👩‍👧‍👦, which is 11
 * UTF-16 units, and 🏴󠁧󠁢󠁳󠁣󠁴󠁿, which is 14. `Intl.Segmenter` counts any ZWJ or
 * skin-tone sequence as the one character a user actually sees.
 */
export const zEmoji = z.string().min(1).max(32).refine((s) => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let count = 0
  for (const _ of segmenter.segment(s)) {
    if (++count > 1) return false
  }
  return count === 1
}, 'expected a single emoji')

export const zIanaTimezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  }
  catch {
    return false
  }
}, 'unknown IANA timezone')

/**
 * A PATCH schema built from a CREATE schema: every field optional, and every
 * `.default()` stripped.
 *
 * `create.partial()` looks like it does this but does NOT remove defaults — in
 * zod 4 a `.partial()` field is `ZodOptional<ZodDefault<T>>`, and the default
 * still fires when the key is absent. So `patch.parse({ enabled: false })`
 * silently returns every other defaulted field too, and a service that does
 * `db.update(...).set(patch)` writes them. That is how flipping a rule's
 * on/off switch used to rewrite its match field, match type and priority.
 *
 * Validation is unchanged for the fields that ARE sent — only the "absent
 * means take the default" behaviour goes away, which is what PATCH means.
 */
export function patchOf<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, field] of Object.entries(schema.shape)) {
    // Peel optional/default wrappers; stop at nullable so `.nullish()` fields
    // keep accepting an explicit null (which is a real value, not an absence).
    // zod doesn't type `innerType` on the base def, hence the narrow cast.
    let inner = field as z.ZodTypeAny
    for (;;) {
      const def = inner._def as unknown as { type?: string, innerType?: z.ZodTypeAny }
      if ((def.type !== 'optional' && def.type !== 'default') || !def.innerType) break
      inner = def.innerType
    }
    shape[key] = inner.optional()
  }
  return z.object(shape)
}
