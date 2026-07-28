/**
 * The only sanctioned way to put a URL that came out of the database into an
 * `href`.
 *
 * `zHttpUrl` stops a `javascript:` or `data:text/html,…` URL being SAVED, but
 * a schema does not clean rows that are already there: every wish-list item
 * and recipe stored before that validator existed still holds whatever
 * `z.string().url()` waved through. Those rows are rendered straight into a
 * link, and a `javascript:` href runs on the board's own origin, with the
 * household session cookie, as soon as anyone taps it. Anyone in the house —
 * kids included — can write one, and some boards are exposed to the internet.
 *
 * So the check happens again at the point of rendering, and it is the render
 * site that must be impossible to get wrong: this returns `undefined` for
 * anything it does not trust, and Vue drops an attribute bound to `undefined`
 * entirely. `:href="safeExternalUrl(x)"` therefore degrades to an `<a>` with
 * no href — inert text — rather than a live weapon. Pair it with
 * `v-if="safeExternalUrl(x)"` when the element only makes sense as a link.
 *
 * It returns the PARSED `href`, not the caller's string. HTML's navigation
 * rules strip tabs, newlines and leading control characters from a URL before
 * resolving the scheme, so `java\nscript:alert(1)` navigates as `javascript:`;
 * handing back the value the URL parser actually inspected closes that gap
 * instead of trusting the two to agree.
 */
export function safeExternalUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  }
  catch {
    // Not parseable as an absolute URL — never guess, never render it.
    return undefined
  }
}
