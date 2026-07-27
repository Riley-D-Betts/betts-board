import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The upgrade path, not the fresh install.
 *
 * Every other DB test starts from an empty database and runs every migration,
 * which can't catch a migration that only works on a clean slate. Real
 * households have a populated database and migrations run automatically on
 * boot — so this applies the finance migration on top of the PREVIOUS
 * release's schema, with data in it, exactly as a running board would.
 */

const drizzleDir = fileURLToPath(new URL('../../drizzle', import.meta.url))
const migrations = readdirSync(drizzleDir).filter(f => f.endsWith('.sql')).sort()
const FINANCE_MIGRATION = '0006_finance.sql'

function applyMigration(db: Database.Database, file: string) {
  const sql = readFileSync(join(drizzleDir, file), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed) db.exec(trimmed)
  }
}

let db: Database.Database
let before: Record<string, number>

const HOUSEHOLD_ID = 'hh-1'

beforeAll(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')

  // The schema as it shipped before this branch.
  for (const file of migrations.filter(f => f !== FINANCE_MIGRATION)) applyMigration(db, file)

  db.prepare(`insert into households (id, name, password_hash, timezone, ics_token, settings, created_at)
              values (?,?,?,?,?,?,?)`)
    .run(HOUSEHOLD_ID, 'Betts', 'argon2hash', 'America/Boise', 'tok123', JSON.stringify({ weekStartsOn: 0 }), Date.now())
  for (const [id, name, role] of [['p1', 'Dad', 'admin'], ['p2', 'Mum', 'adult'], ['p3', 'Kid', 'kid']]) {
    db.prepare(`insert into profiles (id, household_id, name, color, role, sort_order, created_at)
                values (?,?,?,?,?,?,?)`).run(id, HOUSEHOLD_ID, name, '#2563eb', role, 0, Date.now())
  }
  db.prepare(`insert into events (id, household_id, title, is_all_day, start_at, timezone, created_at, updated_at)
              values (?,?,?,?,?,?,?,?)`)
    .run('e1', HOUSEHOLD_ID, 'Soccer practice', 0, Date.now(), 'America/Boise', Date.now(), Date.now())

  const count = (table: string) =>
    (db.prepare(`select count(*) n from ${table}`).get() as { n: number }).n
  before = { households: count('households'), profiles: count('profiles'), events: count('events') }

  applyMigration(db, FINANCE_MIGRATION)
})

describe('the finance migration on an existing board', () => {
  it('applies on top of a populated pre-finance database', () => {
    const tables = db.prepare(
      `select name from sqlite_master where type='table' and name like 'finance_%'`,
    ).all() as { name: string }[]
    expect(tables.length).toBeGreaterThanOrEqual(13)
  })

  it('leaves the household’s existing data exactly as it was', () => {
    const count = (table: string) =>
      (db.prepare(`select count(*) n from ${table}`).get() as { n: number }).n
    expect({ households: count('households'), profiles: count('profiles'), events: count('events') })
      .toEqual(before)
  })

  it('enrols nobody — money stays locked until a person sets a PIN', () => {
    const members = db.prepare('select count(*) n from finance_members').get() as { n: number }
    const withPin = db.prepare('select count(*) n from profiles where pin_hash is not null').get() as { n: number }
    expect(members.n).toBe(0)
    expect(withPin.n).toBe(0)
  })

  it.each([
    'finance_txn_external_unique',
    'finance_accounts_external_unique',
    'finance_sessions_nonce_unique',
    'finance_budgets_unique',
    'finance_bill_payments_unique',
  ])('creates the %s index', (name) => {
    const found = db.prepare(`select name from sqlite_master where type='index' and name = ?`).get(name)
    expect(found).toBeTruthy()
  })
})

describe('the transaction unique index', () => {
  const insert = () => db.prepare(`insert into finance_transactions
    (id, household_id, account_id, external_id, posted_at, posted_date, amount_minor, currency,
     currency_exponent, description, pending, source, created_at, updated_at)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)

  beforeAll(() => {
    db.prepare(`insert into finance_accounts (id, household_id, name, type, currency, currency_exponent,
                balance_source, balance_minor, is_hidden, include_in_net_worth, sort_order, created_at, updated_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('a1', HOUSEHOLD_ID, 'Checking', 'checking', 'USD', 2, 'ledger', 0, 0, 1, 0, Date.now(), Date.now())
  })

  it('lets two identical hand-entered rows coexist', () => {
    // Two $5 coffees on the same day are both real. SQLite treats NULLs as
    // distinct in a unique index, which is exactly what makes this work.
    const stmt = insert()
    const row = (id: string) => [id, HOUSEHOLD_ID, 'a1', null, Date.now(), '2026-07-10', -500, 'USD', 2, 'Coffee', 0, 'manual', Date.now(), Date.now()]
    expect(() => stmt.run(...row('t1'))).not.toThrow()
    expect(() => stmt.run(...row('t2'))).not.toThrow()
  })

  it('rejects the same bank transaction twice, which is what makes sync idempotent', () => {
    const stmt = insert()
    const row = (id: string) => [id, HOUSEHOLD_ID, 'a1', 'BANK-1', Date.now(), '2026-07-10', -500, 'USD', 2, 'X', 0, 'sync', Date.now(), Date.now()]
    expect(() => stmt.run(...row('t3'))).not.toThrow()
    expect(() => stmt.run(...row('t4'))).toThrow()
  })

  it('keeps two accounts’ identical bank ids apart', () => {
    db.prepare(`insert into finance_accounts (id, household_id, name, type, currency, currency_exponent,
                balance_source, balance_minor, is_hidden, include_in_net_worth, sort_order, created_at, updated_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('a2', HOUSEHOLD_ID, 'Savings', 'savings', 'USD', 2, 'bank', 0, 0, 1, 0, Date.now(), Date.now())
    expect(() => insert().run(
      't5', HOUSEHOLD_ID, 'a2', 'BANK-1', Date.now(), '2026-07-10', -500, 'USD', 2, 'X', 0, 'sync', Date.now(), Date.now(),
    )).not.toThrow()
  })
})
