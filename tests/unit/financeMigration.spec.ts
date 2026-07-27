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
const SPLITS_MIGRATION = '0007_transaction-splits.sql'
/**
 * Everything that shipped before money did. Taken by position rather than by
 * excluding the finance files: a later migration can depend on 0006, so
 * "all except 0006" would try to run it against a schema without the finance
 * tables and fail for a reason that has nothing to do with what's under test.
 */
const PRE_FINANCE = migrations.slice(0, migrations.indexOf(FINANCE_MIGRATION))

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

  // The schema as it shipped before money.
  for (const file of PRE_FINANCE) applyMigration(db, file)

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

/**
 * The split backfill, on a database that already has a ledger in it.
 *
 * This is the dangerous half of migration 0007: it rewrites the categorisation
 * of every transaction a household already has, and the fresh-install path
 * cannot catch a mistake because a fresh install has nothing to backfill.
 *
 * Its own database rather than the shared one above — the backfill's whole
 * subject is the rows that exist when it runs.
 */
describe('the split backfill', () => {
  let sdb: Database.Database
  const HH = 'hh-s'

  beforeAll(() => {
    sdb = new Database(':memory:')
    sdb.pragma('foreign_keys = ON')
    for (const file of [...PRE_FINANCE, FINANCE_MIGRATION]) applyMigration(sdb, file)

    sdb.prepare(`insert into households (id, name, password_hash, timezone, ics_token, settings, created_at)
                 values (?,?,?,?,?,?,?)`)
      .run(HH, 'Betts', 'hash', 'America/Boise', 'tok', JSON.stringify({}), Date.now())
    sdb.prepare(`insert into profiles (id, household_id, name, color, role, sort_order, created_at)
                 values (?,?,?,?,?,?,?)`).run('sp1', HH, 'Dad', '#2563eb', 'admin', 0, Date.now())
    sdb.prepare(`insert into finance_accounts (id, household_id, name, type, currency, currency_exponent,
                 balance_source, balance_minor, is_hidden, include_in_net_worth, sort_order, created_at, updated_at)
                 values (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('sa1', HH, 'Checking', 'checking', 'USD', 2, 'ledger', 0, 0, 1, 0, Date.now(), Date.now())
    for (const [id, name] of [['sc1', 'Groceries'], ['sc2', 'Paycheck']]) {
      sdb.prepare(`insert into finance_categories (id, household_id, name, kind, sort_order, is_system, created_at)
                   values (?,?,?,?,?,?,?)`).run(id, HH, name, name === 'Paycheck' ? 'income' : 'expense', 0, 0, Date.now())
    }

    const txn = sdb.prepare(`insert into finance_transactions
      (id, household_id, account_id, external_id, posted_at, posted_date, amount_minor, currency,
       currency_exponent, description, category_id, categorized_by, pending, source, created_at, updated_at)
      values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const rows: [string, number, string | null, string | null][] = [
      ['st1', -4210, 'sc1', 'user'],
      ['st2', -1999, 'sc1', 'rule'],
      ['st3', -750, null, null],
      ['st4', 250000, 'sc2', 'import'],
    ]
    for (const [id, amount, category, by] of rows) {
      txn.run(id, HH, 'sa1', null, Date.now(), '2026-07-10', amount, 'USD', 2,
        `row ${id}`, category, by, 0, 'manual', Date.now(), Date.now())
    }

    applyMigration(sdb, SPLITS_MIGRATION)
  })

  it('gives every existing transaction exactly one split', () => {
    const counts = sdb.prepare(`select t.id, count(s.id) n
      from finance_transactions t
      left join finance_transaction_splits s on s.transaction_id = t.id
      group by t.id`).all() as { id: string, n: number }[]
    expect(counts).toHaveLength(4)
    expect(counts.every(c => c.n === 1)).toBe(true)
  })

  it('carries the category, amount, and who chose it', () => {
    const rows = sdb.prepare(`select transaction_id, category_id, amount_minor, categorized_by
      from finance_transaction_splits order by transaction_id`).all() as Record<string, unknown>[]
    expect(rows).toEqual([
      { transaction_id: 'st1', category_id: 'sc1', amount_minor: -4210, categorized_by: 'user' },
      { transaction_id: 'st2', category_id: 'sc1', amount_minor: -1999, categorized_by: 'rule' },
      { transaction_id: 'st3', category_id: null, amount_minor: -750, categorized_by: null },
      { transaction_id: 'st4', category_id: 'sc2', amount_minor: 250000, categorized_by: 'import' },
    ])
  })

  it('holds the invariant every aggregation now depends on', () => {
    const off = sdb.prepare(`select t.id from finance_transactions t
      join finance_transaction_splits s on s.transaction_id = t.id
      group by t.id having sum(s.amount_minor) <> t.amount_minor`).all()
    expect(off).toEqual([])
  })

  it('drops the columns, so nothing can read a stale second source of truth', () => {
    const columns = (sdb.prepare(`pragma table_info(finance_transactions)`).all() as { name: string }[])
      .map(c => c.name)
    expect(columns).not.toContain('category_id')
    expect(columns).not.toContain('categorized_by')
    expect(columns).toContain('amount_minor')
  })

  it('gives every backfilled split a distinct id', () => {
    const n = sdb.prepare('select count(distinct id) n from finance_transaction_splits').get() as { n: number }
    expect(n.n).toBe(4)
  })

  it('still enforces the foreign key after the table rebuild', () => {
    // The rebuild drops and renames finance_transactions with foreign_keys off.
    // If the splits FK didn't survive that, an orphan would insert cleanly.
    expect(() => sdb.prepare(`insert into finance_transaction_splits
      (id, transaction_id, category_id, amount_minor, sort_order, created_at) values (?,?,?,?,?,?)`)
      .run('orphan', 'no-such-txn', null, -1, 0, Date.now())).toThrow()
  })

  it('cascades: deleting a transaction takes its splits with it', () => {
    sdb.prepare('delete from finance_transactions where id = ?').run('st3')
    const left = sdb.prepare('select count(*) n from finance_transaction_splits where transaction_id = ?')
      .get('st3') as { n: number }
    expect(left.n).toBe(0)
  })
})
