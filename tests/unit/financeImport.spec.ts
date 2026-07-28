import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeAccounts, financeImportBatches,
  financeTransactions, households, profiles,
} from '../../server/db/schema'
import { installNitroGlobals } from '../support/nitroGlobals'
import {
  detectFormat, guessColumnMap, parseCsv, parseCsvDate, parseCsvStatement, parseOfx,
} from '../../server/services/finance/parseFile'

installNitroGlobals()

const { commitImport, previewImport, revertImportBatch } = await import('../../server/services/finance/import')
const { createAccount } = await import('../../server/services/finance/accounts')

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/finance/${name}`, import.meta.url)), 'utf8')

describe('parseOfx', () => {
  const result = parseOfx(fixture('statement.ofx'))

  it('reads every transaction with exact amounts', () => {
    expect(result.rows).toHaveLength(3)
    expect(result.rows.map(r => r.amountMinor)).toEqual([-3353, 245000, -125000])
  })

  it('reads the date without a timezone step, whatever the OFX suffix says', () => {
    // The file says [-7:MST]. Converting would move a midnight transaction to
    // the previous day; the statement's own date is the date.
    expect(result.rows.map(r => r.postedDate)).toEqual(['2026-01-05', '2026-01-15', '2026-01-31'])
  })

  it('decodes SGML entities in the description', () => {
    expect(result.rows[0]!.description).toBe('Uncle Frank\'s Bait Shop')
  })

  it.each([
    ['&amp;', '&'],
    ['&lt;', '<'],
    ['&gt;', '>'],
    ['&quot;', '"'],
    ['&apos;', '\''],
    ['&#39;', '\''],
    ['&#x27;', '\''],
    ['B&amp;Q', 'B&Q'],
    // The one that matters: decoding must not re-read its own output.
    // A chain of .replace() calls turns this into "<", losing the fact that
    // the statement contained the literal text "&lt;".
    ['&amp;lt;', '&lt;'],
    ['&amp;amp;', '&amp;'],
    // Unknown or malformed entities are left alone rather than mangled.
    ['&nosuch;', '&nosuch;'],
    ['R&D', 'R&D'],
    ['&#999999999;', '&#999999999;'],
  ])('decodes %j to %j exactly once', (input, expected) => {
    const xml = `<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20260105</DTPOSTED>`
      + `<TRNAMT>-1.00</TRNAMT><FITID>e</FITID><NAME>${input}</NAME></STMTTRN></BANKTRANLIST></OFX>`
    expect(parseOfx(xml).rows[0]!.description).toBe(expected)
  })

  it('keeps the FITID for exact dedup', () => {
    expect(result.rows[0]!.externalId).toBe('202601050001')
  })

  it('picks up the currency and account number', () => {
    expect(result.currency).toBe('USD')
    expect(result.accountHint).toBe('0001234567')
  })

  it('keeps a memo that differs from the name, and drops one that does not', () => {
    expect(result.rows[0]!.memo).toBe('card ending 4242')
    expect(result.rows[1]!.memo).toBeNull()
  })

  it('handles OFX 2.x XML with closed tags', () => {
    const xml = `<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20260105</DTPOSTED>`
      + `<TRNAMT>-10.00</TRNAMT><FITID>abc</FITID><NAME>Shop</NAME></STMTTRN></BANKTRANLIST></OFX>`
    const parsed = parseOfx(xml)
    expect(parsed.rows).toEqual([expect.objectContaining({ postedDate: '2026-01-05', amountMinor: -1000 })])
  })

  it('rejects a file that is not OFX at all', () => {
    expect(() => parseOfx('date,amount\n2026-01-01,5')).toThrow(/does not look like/)
  })
})

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas, and CRLF', () => {
    const table = parseCsv('a,b\r\n"x,1","he said ""hi"""\r\n')
    expect(table).toEqual([['a', 'b'], ['x,1', 'he said "hi"']])
  })

  it('strips a BOM so the first header still matches by name', () => {
    expect(parseCsv('﻿Date,Amount\n2026-01-01,5')[0]).toEqual(['Date', 'Amount'])
  })

  it('drops blank lines rather than emitting empty rows', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toHaveLength(2)
  })
})

describe('parseCsvDate', () => {
  it.each([
    ['2026-01-05', 'auto', '2026-01-05'],
    ['2026/01/05', 'auto', '2026-01-05'],
    ['01/05/2026', 'MDY', '2026-01-05'],
    ['05/01/2026', 'DMY', '2026-01-05'],
    ['13/01/2026', 'auto', '2026-01-13'], // >12 first ⇒ must be DMY
    ['01/13/2026', 'auto', '2026-01-13'], // >12 second ⇒ must be MDY
    ['1/5/26', 'MDY', '2026-01-05'],
    ['05.01.2026', 'DMY', '2026-01-05'],
  ])('%s (%s) -> %s', (input, order, expected) => {
    expect(parseCsvDate(input, order as 'auto' | 'MDY' | 'DMY')).toBe(expected)
  })

  it('returns null rather than guessing at nonsense', () => {
    expect(parseCsvDate('yesterday')).toBeNull()
    expect(parseCsvDate('')).toBeNull()
    expect(parseCsvDate('99/99/2026')).toBeNull()
  })
})

describe('guessColumnMap', () => {
  it('prefers a debit/credit pair over an unsigned amount column', () => {
    // When a file has all three, "amount" is usually a magnitude — using it
    // would flip the sign on half the rows.
    const map = guessColumnMap(['Date', 'Description', 'Amount', 'Money Out', 'Money In'])
    expect(map).toMatchObject({ debit: 'Money Out', credit: 'Money In' })
    expect(map.amount).toBeUndefined()
  })

  it('falls back to a single signed amount column', () => {
    expect(guessColumnMap(['Date', 'Description', 'Amount'])).toMatchObject({ amount: 'Amount' })
  })
})

describe('parseCsvStatement', () => {
  const result = parseCsvStatement(fixture('statement-debit-credit.csv'), { dateFormat: 'DMY' })

  it('signs a debit/credit pair correctly', () => {
    expect(result.rows.map(r => r.amountMinor)).toEqual([-3353, 245000, -125000])
  })

  it('strips thousands separators without losing a digit', () => {
    expect(result.rows[1]!.amountMinor).toBe(245000)
  })

  it('reads DMY dates when told to', () => {
    expect(result.rows.map(r => r.postedDate)).toEqual(['2026-01-05', '2026-01-15', '2026-01-31'])
  })

  it.each([
    ['$1,234.56', 123456],
    ['(45.00)', -4500], // accounting negative
    ['1.234,56', 123456], // European decimal comma
    ['-12.00', -1200],
  ])('normalises %s to %d minor units', (cell, expected) => {
    const csv = `Date,Description,Amount\n2026-01-01,x,"${cell}"`
    expect(parseCsvStatement(csv, {}).rows[0]!.amountMinor).toBe(expected)
  })

  it('says which columns it needs rather than guessing', () => {
    expect(() => parseCsvStatement('foo,bar\n1,2', {})).toThrow(/which columns/)
  })

  it('warns about a bad row but imports the rest', () => {
    const csv = 'Date,Description,Amount\nnope,x,5.00\n2026-01-02,y,6.00'
    const parsed = parseCsvStatement(csv, {})
    expect(parsed.rows).toHaveLength(1)
    // A code and its row, not a sentence — the screen writes the sentence in
    // whichever language the board is set to.
    expect(parsed.warnings[0]).toEqual({ code: 'badDate', row: 2 })
  })
})

describe('detectFormat', () => {
  it.each([
    ['statement.ofx', '', 'ofx'],
    ['statement.QFX', '', 'qfx'],
    ['export.csv', '', 'csv'],
    ['unknown.txt', '<OFX>', 'ofx'],
    ['unknown.txt', 'a,b', 'csv'],
  ])('%s -> %s', (name, content, expected) => {
    expect(detectFormat(name, content)).toBe(expected)
  })
})

// ── Import against a real database ────────────────────────────────────────

let db: Db
let householdId: string
let profileId: string
let accountId: string

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  db.delete(financeTransactions).run()
  db.delete(financeImportBatches).run()
  db.delete(financeAccounts).run()
  db.delete(profiles).run()
  db.delete(households).run()

  const hh = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get()
  householdId = hh.id
  profileId = db.insert(profiles)
    .values({ householdId, name: 'Dad', color: '#112233', role: 'admin' })
    .returning().get().id
  accountId = createAccount(db, householdId, { name: 'Checking' }).id
})

const ofxArgs = () => ({
  householdId,
  profileId,
  accountId,
  filename: 'statement.ofx',
  content: fixture('statement.ofx'),
  skipRows: [],
})

describe('import round trip', () => {
  it('imports every row on a clean ledger', () => {
    const preview = previewImport(db, ofxArgs())
    expect(preview.rows).toHaveLength(3)
    expect(preview.duplicateCount).toBe(0)

    const result = commitImport(db, ofxArgs())
    expect(result.imported).toBe(3)
    expect(db.select().from(financeTransactions).all()).toHaveLength(3)
  })

  it('flags every row as a duplicate on a second run, but does not drop them', () => {
    commitImport(db, ofxArgs())
    const preview = previewImport(db, ofxArgs())

    // A review step, deliberately: two identical $5 coffees on one day are
    // both real, so nothing is ever auto-discarded.
    expect(preview.duplicateCount).toBe(3)
    expect(preview.rows.every(r => r.duplicateOf)).toBe(true)
  })

  it('imports nothing when the user accepts every duplicate suggestion', () => {
    commitImport(db, ofxArgs())
    const preview = previewImport(db, ofxArgs())
    const result = commitImport(db, {
      ...ofxArgs(),
      skipRows: preview.rows.filter(r => r.duplicateOf).map(r => r.index),
    })

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(3)
    expect(db.select().from(financeTransactions).all()).toHaveLength(3)
  })

  it('matches a CSV of the same statement against the OFX already imported', () => {
    commitImport(db, ofxArgs())
    const preview = previewImport(db, {
      householdId,
      accountId,
      filename: 'statement.csv',
      content: fixture('statement-debit-credit.csv'),
      dateFormat: 'DMY',
    })
    // Different file, no FITID — caught by amount + date window + description.
    expect(preview.duplicateCount).toBe(3)
  })

  it('does not flag two identical amounts on the same day as one duplicate', () => {
    const csv = 'Date,Description,Amount\n2026-03-01,COFFEE,-5.00\n2026-03-01,COFFEE,-5.00'
    const args = { householdId, profileId, accountId, filename: 'c.csv', content: csv, skipRows: [] }
    const result = commitImport(db, args)
    expect(result.imported).toBe(2)
  })

  it('undoes a whole batch, which is the point of tracking it', () => {
    const { batchId } = commitImport(db, ofxArgs())
    expect(revertImportBatch(db, householdId, batchId)).toEqual({ removed: 3 })
    expect(db.select().from(financeTransactions).all()).toHaveLength(0)
  })

  it('refuses to undo the same batch twice', () => {
    const { batchId } = commitImport(db, ofxArgs())
    revertImportBatch(db, householdId, batchId)
    expect(() => revertImportBatch(db, householdId, batchId))
      .toThrow(expect.objectContaining({ statusCode: 409 }))
  })

  it('leaves an OFX FITID out of externalId, which belongs to bank sync', () => {
    commitImport(db, ofxArgs())
    // Sharing the column would let a statement's FITID collide with a synced
    // id and make the unique index reject a legitimate row.
    for (const row of db.select().from(financeTransactions).all()) {
      expect(row.externalId).toBeNull()
      expect(row.source).toBe('import')
    }
  })
})
