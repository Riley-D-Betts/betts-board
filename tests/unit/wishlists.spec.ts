import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { createDb, setDb } from '../../server/db/client'
import { households, profiles, wishlistItems, wishlists } from '../../server/db/schema'
import { defaultHouseholdSettings } from '../../server/db/schema/household'
import {
  addItem, archiveWishlist, canEditList, createWishlist, deleteItem,
  getWishlist, listWishlists, requireList, updateItem, updateWishlist,
} from '../../server/services/wishlists/store'

let db: Db
let householdId: string
let otherHouseholdId: string
let mom: string
let kid: string
let otherKid: string

beforeEach(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)

  const makeHousehold = (name: string, token: string) => db.insert(households).values({
    name, passwordHash: 'x', timezone: 'America/Boise', icsToken: token,
    settings: defaultHouseholdSettings,
  }).returning().get().id

  householdId = makeHousehold('Betts', 'tok')
  otherHouseholdId = makeHousehold('Neighbours', 'tok2')

  mom = db.insert(profiles).values({ householdId, name: 'Mom', color: '#ec4899', role: 'admin' }).returning().get().id
  kid = db.insert(profiles).values({ householdId, name: 'Emma', color: '#22c55e', role: 'kid' }).returning().get().id
  otherKid = db.insert(profiles).values({ householdId, name: 'Sam', color: '#3b82f6', role: 'kid' }).returning().get().id
})

function makeList(ownerId = kid, title = "Emma's birthday") {
  return createWishlist(db, householdId, { title, occasion: 'Birthday', eventDate: '2026-09-01' }, ownerId)
}

describe('createWishlist', () => {
  it('creates a list owned by the acting profile by default', () => {
    const list = createWishlist(db, householdId, { title: 'Christmas' }, kid)
    expect(list).toMatchObject({ title: 'Christmas', profileId: kid, profileName: 'Emma', itemCount: 0 })
  })

  it('lets an adult create a list for someone else', () => {
    const list = createWishlist(db, householdId, { title: 'For Emma', profileId: kid }, mom)
    expect(list.profileId).toBe(kid)
  })

  it('rejects a profile from another household', () => {
    const outsider = db.insert(profiles).values({
      householdId: otherHouseholdId, name: 'Stranger', color: '#000000', role: 'adult',
    }).returning().get().id
    expect(() => createWishlist(db, householdId, { title: 'Nope', profileId: outsider }, mom)).toThrow()
  })
})

describe('listWishlists', () => {
  it('is shared — every list in the household is visible', () => {
    makeList(kid, "Emma's")
    makeList(otherKid, "Sam's")
    expect(listWishlists(db, householdId).map(l => l.title).sort()).toEqual(["Emma's", "Sam's"])
  })

  it('scopes to the household', () => {
    makeList()
    expect(listWishlists(db, otherHouseholdId)).toEqual([])
  })

  it('counts items per list without mixing them up', () => {
    const a = makeList(kid, 'A')
    const b = makeList(otherKid, 'B')
    addItem(db, householdId, a.id, { name: 'one' }, kid)
    addItem(db, householdId, a.id, { name: 'two' }, kid)
    addItem(db, householdId, b.id, { name: 'three' }, otherKid)
    const byTitle = Object.fromEntries(listWishlists(db, householdId).map(l => [l.title, l.itemCount]))
    expect(byTitle).toEqual({ A: 2, B: 1 })
  })

  it('hides archived lists', () => {
    const list = makeList()
    archiveWishlist(db, householdId, list.id)
    expect(listWishlists(db, householdId)).toEqual([])
  })
})

describe('getWishlist', () => {
  it('returns the list with its items', () => {
    const list = makeList()
    addItem(db, householdId, list.id, { name: 'Lego', price: 'about $30', priority: 2 }, kid)
    const full = getWishlist(db, householdId, list.id)
    expect(full.items).toHaveLength(1)
    expect(full.items![0]).toMatchObject({ name: 'Lego', price: 'about $30', priority: 2 })
  })

  it('404s for a list in another household rather than leaking it', () => {
    const list = makeList()
    expect(() => getWishlist(db, otherHouseholdId, list.id)).toThrow()
  })

  it('404s for an unknown id', () => {
    expect(() => getWishlist(db, householdId, 'nope')).toThrow()
  })
})

describe('canEditList', () => {
  it('lets the owner edit their own list', () => {
    const list = requireList(db, householdId, makeList(kid).id)
    expect(canEditList(list, { id: kid, role: 'kid' })).toBe(true)
  })

  it('lets an adult or admin edit anyone’s list', () => {
    const list = requireList(db, householdId, makeList(kid).id)
    expect(canEditList(list, { id: mom, role: 'admin' })).toBe(true)
    expect(canEditList(list, { id: 'someone', role: 'adult' })).toBe(true)
  })

  it("stops a kid editing another kid's list", () => {
    const list = requireList(db, householdId, makeList(kid).id)
    expect(canEditList(list, { id: otherKid, role: 'kid' })).toBe(false)
  })
})

describe('items', () => {
  it('updates fields individually', () => {
    const list = makeList()
    const item = addItem(db, householdId, list.id, { name: 'Bike' }, kid)
    const updated = updateItem(db, householdId, list.id, item.id, { price: '£120', priority: 2 })
    expect(updated).toMatchObject({ name: 'Bike', price: '£120', priority: 2 })
  })

  it('clears an optional field with null', () => {
    const list = makeList()
    const item = addItem(db, householdId, list.id, { name: 'Bike', notes: 'red one' }, kid)
    expect(updateItem(db, householdId, list.id, item.id, { notes: null }).notes).toBeNull()
  })

  it('deletes an item', () => {
    const list = makeList()
    const item = addItem(db, householdId, list.id, { name: 'Bike' }, kid)
    deleteItem(db, householdId, list.id, item.id)
    expect(getWishlist(db, householdId, list.id).items).toEqual([])
  })

  it('refuses an item id from a different list', () => {
    const a = makeList(kid, 'A')
    const b = makeList(otherKid, 'B')
    const item = addItem(db, householdId, a.id, { name: 'Bike' }, kid)
    expect(() => deleteItem(db, householdId, b.id, item.id)).toThrow()
  })

  it('cascades item deletion when the list row goes away', () => {
    const list = makeList()
    addItem(db, householdId, list.id, { name: 'Bike' }, kid)
    // Archive is the app-level delete; the FK cascade covers a hard delete.
    db.delete(wishlists).run()
    expect(db.select().from(wishlistItems).all()).toEqual([])
  })
})

describe('updateWishlist', () => {
  it('renames and re-dates a list', () => {
    const list = makeList()
    const updated = updateWishlist(db, householdId, list.id, {
      title: 'Christmas 2026', occasion: 'Christmas', eventDate: '2026-12-25',
    })
    expect(updated).toMatchObject({ title: 'Christmas 2026', occasion: 'Christmas', eventDate: '2026-12-25' })
  })

  it('clears the date without touching the title', () => {
    const list = makeList()
    const updated = updateWishlist(db, householdId, list.id, { eventDate: null })
    expect(updated.eventDate).toBeNull()
    expect(updated.title).toBe("Emma's birthday")
  })

  it('keeps the event date as a plain YYYY-MM-DD string', () => {
    // Calendar dates must never round-trip through a timezone.
    const list = makeList()
    expect(getWishlist(db, householdId, list.id).eventDate).toBe('2026-09-01')
  })
})
