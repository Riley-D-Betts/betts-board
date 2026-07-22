import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { createDb, type Db } from '../../server/db/client'
import { choreCompletions, chores, defaultHouseholdSettings, households, profiles, rewardRedemptions } from '../../server/db/schema'
import { archiveReward, createReward, getBalances, listRedemptions, listRewards, redeem, updateReward } from '../../server/services/rewards/store'

let db: Db
let householdId: string
let kid: string
let mom: string
let choreId: string

beforeEach(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  const hh = db.insert(households).values({
    name: 'Test',
    passwordHash: 'x',
    timezone: 'America/Boise',
    icsToken: 'tok',
    settings: defaultHouseholdSettings,
  }).returning().get()
  householdId = hh.id
  kid = db.insert(profiles).values({ householdId, name: 'Kid', color: '#22c55e', role: 'kid' }).returning().get().id
  mom = db.insert(profiles).values({ householdId, name: 'Mom', color: '#ec4899', role: 'admin' }).returning().get().id
  choreId = db.insert(chores).values({
    householdId,
    title: 'Dishes',
    points: 1,
    startDate: '2026-03-01',
  }).returning().get().id
})

/** Award stars via chore completion snapshots (one row per date). */
function earn(profileId: string, points: number, dates: string[]) {
  for (const dueDate of dates) {
    db.insert(choreCompletions).values({
      choreId,
      profileId,
      dueDate,
      completedAt: new Date(),
      pointsAwarded: points,
    }).run()
  }
}

function makeReward(input?: { title?: string, cost?: number }) {
  return createReward(db, householdId, {
    title: input?.title ?? 'Ice cream trip',
    emoji: '🍦',
    cost: input?.cost ?? 5,
  })
}

describe('getBalances', () => {
  it('sums earned from completion snapshots per non-archived profile', () => {
    earn(kid, 3, ['2026-03-01', '2026-03-02'])
    earn(mom, 2, ['2026-03-01'])

    const balances = getBalances(db, householdId)
    expect(balances.find(b => b.profileId === kid)).toMatchObject({ name: 'Kid', earned: 6, spent: 0, balance: 6 })
    expect(balances.find(b => b.profileId === mom)).toMatchObject({ earned: 2, spent: 0, balance: 2 })
  })

  it('subtracts redemption snapshots from the balance', () => {
    earn(kid, 5, ['2026-03-01', '2026-03-02'])
    const reward = makeReward({ cost: 4 })
    redeem(db, { rewardId: reward.id, profileId: kid })

    const balance = getBalances(db, householdId).find(b => b.profileId === kid)!
    expect(balance).toMatchObject({ earned: 10, spent: 4, balance: 6 })
  })

  it('excludes archived profiles', () => {
    db.update(profiles).set({ archivedAt: new Date() }).where(eq(profiles.id, mom)).run()
    expect(getBalances(db, householdId).map(b => b.profileId)).toEqual([kid])
  })
})

describe('redeem', () => {
  it('a kid can redeem for themselves and the redemption is recorded', () => {
    earn(kid, 5, ['2026-03-01'])
    const reward = makeReward({ cost: 5 })

    const row = redeem(db, { rewardId: reward.id, profileId: kid })
    expect(row).toMatchObject({
      rewardId: reward.id,
      title: 'Ice cream trip',
      costPoints: 5,
      profileId: kid,
      profileName: 'Kid',
    })
    expect(typeof row.redeemedAt).toBe('number')

    expect(getBalances(db, householdId).find(b => b.profileId === kid)!.balance).toBe(0)
    const recent = listRedemptions(db, { householdId })
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject({ id: row.id, title: 'Ice cream trip', profileName: 'Kid', costPoints: 5 })
  })

  it('insufficient balance throws 400 and inserts nothing', () => {
    earn(kid, 2, ['2026-03-01'])
    const reward = makeReward({ cost: 5 })

    expect(() => redeem(db, { rewardId: reward.id, profileId: kid })).toThrowError(/Not enough stars/)
    expect(db.select().from(rewardRedemptions).all()).toHaveLength(0)
    expect(getBalances(db, householdId).find(b => b.profileId === kid)!.balance).toBe(2)
  })

  it('cost edits after a redemption leave history intact', () => {
    earn(kid, 10, ['2026-03-01'])
    const reward = makeReward({ cost: 4 })
    const row = redeem(db, { rewardId: reward.id, profileId: kid })

    updateReward(db, householdId, reward.id, { cost: 9, title: 'Renamed' })

    const recent = listRedemptions(db, { householdId })
    expect(recent[0]).toMatchObject({ id: row.id, costPoints: 4, title: 'Ice cream trip' })
    expect(getBalances(db, householdId).find(b => b.profileId === kid)!.balance).toBe(6)
  })

  it('an archived reward is not listed and not redeemable', () => {
    earn(kid, 20, ['2026-03-01'])
    const reward = makeReward()
    archiveReward(db, householdId, reward.id)

    expect(listRewards(db, householdId)).toHaveLength(0)
    expect(() => redeem(db, { rewardId: reward.id, profileId: kid })).toThrowError(/Reward not found/)
  })

  it('unknown reward or profile throws 404', () => {
    const reward = makeReward()
    expect(() => redeem(db, { rewardId: 'nope', profileId: kid })).toThrowError(/Reward not found/)
    expect(() => redeem(db, { rewardId: reward.id, profileId: 'nope' })).toThrowError(/Profile not found/)
  })
})

describe('listRewards / listRedemptions', () => {
  it('orders rewards by sortOrder then title', () => {
    createReward(db, householdId, { title: 'Zebra ride', cost: 1, sortOrder: 0 })
    createReward(db, householdId, { title: 'Apple picking', cost: 1, sortOrder: 0 })
    createReward(db, householdId, { title: 'First!', cost: 1, sortOrder: -1 })
    expect(listRewards(db, householdId).map(r => r.title)).toEqual(['First!', 'Apple picking', 'Zebra ride'])
  })

  it('lists redemptions newest first and respects the limit', () => {
    earn(kid, 100, ['2026-03-01'])
    const reward = makeReward({ cost: 1 })
    for (let i = 0; i < 3; i++) {
      db.insert(rewardRedemptions).values({
        rewardId: reward.id,
        profileId: kid,
        costPoints: 1,
        titleSnapshot: `Redemption ${i}`,
        redeemedAt: new Date(1700000000000 + i * 1000),
      }).run()
    }
    const rows = listRedemptions(db, { householdId, limit: 2 })
    expect(rows.map(r => r.title)).toEqual(['Redemption 2', 'Redemption 1'])
  })
})
