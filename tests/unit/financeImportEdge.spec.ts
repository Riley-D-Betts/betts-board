import { describe, expect, it } from 'vitest'
import { installNitroGlobals } from '../support/nitroGlobals'
import { parseCsv, parseCsvDate, parseCsvStatement, parseOfx } from '../../server/services/finance/parseFile'

installNitroGlobals()

/**
 * The statement shapes real banks actually emit. Each of these was a live bug:
 * an import that silently produced the wrong number is worse than one that
 * refuses the file, because nobody goes back to check.
 */

describe('debit/credit column pairs', () => {
  const csv = (rows: string) => `Date,Description,Money Out,Money In\n${rows}`

  it('does not let a zero-filled unused column win', () => {
    // Most UK/AU exports write "0.00" in the column that doesn't apply rather
    // than leaving it empty. A truthiness check on the string takes the debit
    // branch and turns a £2,450 salary into zero.
    const rows = parseCsvStatement(csv(
      '2026-01-15,PAYROLL,0.00,2450.00\n2026-01-16,SHOP,33.53,0.00\n',
    ), { dateFormat: 'YMD' }).rows

    expect(rows[0]!.amountMinor).toBe(245000)
    expect(rows[1]!.amountMinor).toBe(-3353)
  })

  it('still handles the empty-cell dialect', () => {
    const rows = parseCsvStatement(csv(
      '2026-01-15,PAYROLL,,2450.00\n2026-01-16,SHOP,33.53,\n',
    ), { dateFormat: 'YMD' }).rows
    expect(rows.map(r => r.amountMinor)).toEqual([245000, -3353])
  })

  it('treats a genuine zero-value row as zero, not as a skip', () => {
    const rows = parseCsvStatement(csv('2026-01-15,ADJUSTMENT,0.00,0.00\n'), { dateFormat: 'YMD' }).rows
    expect(rows[0]!.amountMinor).toBe(0)
  })
})

describe('amount normalisation', () => {
  const amount = (cell: string) =>
    parseCsvStatement(`Date,Description,Amount\n2026-01-15,X,"${cell}"\n`, { dateFormat: 'YMD' })
      .rows[0]!.amountMinor

  it.each([
    // A thousands separator with no decimal part must not be read as a
    // decimal point — "1,234" is 1234 units, not 1.234.
    ['1,234', 123400],
    ['2,450', 245000],
    ['1,234,567', 123456700],
    ['1,234.56', 123456],
    ['$1,234.56', 123456],
    ['(45.00)', -4500],
    ['-12.00', -1200],
    ['12', 1200],
  ])('reads %j as %d minor units', (cell, expected) => {
    expect(amount(cell)).toBe(expected)
  })

  it('reads the European dialect, where the comma IS the decimal point', () => {
    // Unambiguous: two digits after the comma and a dot before it.
    expect(amount('1.234,56')).toBe(123456)
    expect(amount('12,50')).toBe(1250)
  })
})

describe('date order is decided once for the whole file', () => {
  it('does not scatter a DMY statement across two months', () => {
    // 05/01 and 15/01 are both January on a UK statement. Deciding per row
    // sends the first to May and the second to January.
    const csv = 'Date,Description,Amount\n05/01/2026,A,-1.00\n15/01/2026,B,-1.00\n25/01/2026,C,-1.00\n'
    const rows = parseCsvStatement(csv, { dateFormat: 'auto' }).rows
    expect(rows.map(r => r.postedDate)).toEqual(['2026-01-05', '2026-01-15', '2026-01-25'])
  })

  it('still reads a US statement as MDY when nothing contradicts it', () => {
    const csv = 'Date,Description,Amount\n01/05/2026,A,-1.00\n01/15/2026,B,-1.00\n'
    const rows = parseCsvStatement(csv, { dateFormat: 'auto' }).rows
    expect(rows.map(r => r.postedDate)).toEqual(['2026-01-05', '2026-01-15'])
  })

  it('obeys an explicit order even when the values look ambiguous', () => {
    const csv = 'Date,Description,Amount\n05/01/2026,A,-1.00\n'
    expect(parseCsvStatement(csv, { dateFormat: 'DMY' }).rows[0]!.postedDate).toBe('2026-01-05')
    expect(parseCsvStatement(csv, { dateFormat: 'MDY' }).rows[0]!.postedDate).toBe('2026-05-01')
  })

  it('parseCsvDate still resolves a single unambiguous value', () => {
    expect(parseCsvDate('15/01/2026', 'auto')).toBe('2026-01-15')
    expect(parseCsvDate('01/15/2026', 'auto')).toBe('2026-01-15')
  })
})

describe('malformed CSV', () => {
  it('does not let a stray quote swallow the rest of the statement', () => {
    // 5" PIPE FITTING is a real description. A quote that isn't at the start
    // of a field is literal text, not the start of a quoted field.
    const csv = 'Date,Description,Amount\n2026-01-15,5" PIPE FITTING,-12.00\n2026-01-16,NEXT ROW,-13.00\n'
    expect(parseCsv(csv)).toHaveLength(3)

    const rows = parseCsvStatement(csv, { dateFormat: 'YMD' }).rows
    expect(rows).toHaveLength(2)
    expect(rows[0]!.description).toBe('5" PIPE FITTING')
    expect(rows[1]!.amountMinor).toBe(-1300)
  })

  it('still honours properly quoted fields and doubled quotes', () => {
    expect(parseCsv('a,b\n"x,1","he said ""hi"""\n')).toEqual([['a', 'b'], ['x,1', 'he said "hi"']])
  })
})

describe('multi-account OFX', () => {
  const ofx = `<OFX><BANKMSGSRSV1>
<STMTTRNRS><STMTRS><CURDEF>USD<BANKACCTFROM><ACCTID>1111</ACCTID></BANKACCTFROM>
<BANKTRANLIST><STMTTRN><DTPOSTED>20260105</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>A1</FITID><NAME>ACCT ONE</NAME></STMTTRN></BANKTRANLIST>
</STMTRS></STMTTRNRS>
<STMTTRNRS><STMTRS><CURDEF>USD<BANKACCTFROM><ACCTID>2222</ACCTID></BANKACCTFROM>
<BANKTRANLIST><STMTTRN><DTPOSTED>20260106</DTPOSTED><TRNAMT>-20.00</TRNAMT><FITID>B1</FITID><NAME>ACCT TWO</NAME></STMTTRN></BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

  it('refuses a file holding several accounts rather than merging them', () => {
    // Importing into one selected account would silently mix two accounts'
    // history together, and there is no undo that separates them again.
    expect(() => parseOfx(ofx)).toThrow(/more than one account/i)
  })

  it('still accepts an ordinary single-account file', () => {
    const single = `<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20260105</DTPOSTED>`
      + `<TRNAMT>-10.00</TRNAMT><FITID>abc</FITID><NAME>Shop</NAME></STMTTRN></BANKTRANLIST></OFX>`
    expect(parseOfx(single).rows).toHaveLength(1)
  })
})
