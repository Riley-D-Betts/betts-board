import { parseDecimalToMinor } from '#shared/utils/money'

/**
 * OFX/QFX and CSV statement parsing — pure functions, no DB, no HTTP.
 *
 * Written here rather than pulled from npm because CLAUDE.md puts package.json
 * off limits, and the slice of OFX a statement download actually uses is small
 * and stable. OFX 1.x is SGML with unclosed tags; OFX 2.x (and most QFX) is
 * XML. Both are handled by reading tag values up to the next '<'.
 */

export interface ParsedRow {
  /** YYYY-MM-DD. Never timezone-converted — the file's local date is the date. */
  postedDate: string
  amountMinor: number
  description: string
  payee?: string | null
  memo?: string | null
  /** OFX FITID. Absent for CSV, which has no stable identifier. */
  externalId?: string | null
}

export interface ParseResult {
  rows: ParsedRow[]
  /** Non-fatal problems worth telling the user about. */
  warnings: string[]
  currency?: string
  accountHint?: string
}

export class ImportParseError extends Error {}

// ── OFX / QFX ─────────────────────────────────────────────────────────────

/** Reads `<TAG>value` in both SGML (unclosed) and XML (closed) forms. */
function ofxValue(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)`, 'i').exec(block)
  const value = match?.[1]?.trim()
  return value ? decodeEntities(value) : null
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
}

/**
 * ONE pass, deliberately — not a chain of .replace() calls.
 *
 * Replacing `&amp;` first and `&lt;` second means "&amp;lt;" decodes to "<",
 * when it should decode to the literal text "&lt;": the second replace sees
 * the ampersand the first one just produced. A single scan consumes each
 * `&…;` exactly once and never re-reads its own output.
 */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    const lower = body.toLowerCase()
    if (lower.startsWith('#')) {
      const code = lower.startsWith('#x')
        ? Number.parseInt(lower.slice(2), 16)
        : Number(lower.slice(1))
      // Anything outside the Unicode range would make fromCodePoint throw;
      // leave the original text rather than lose the row.
      if (!Number.isInteger(code) || code < 0 || code > 0x10FFFF) return match
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[lower] ?? match
  })
}

/**
 * OFX dates are `YYYYMMDD` optionally followed by `HHMMSS[.SSS][+/-TZ:NAME]`.
 * Only the first 8 characters are used, deliberately: converting a statement
 * timestamp through a timezone is how a transaction moves to the wrong day.
 */
function ofxDate(raw: string | null): string | null {
  if (!raw) return null
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim())
  if (!match) return null
  const [, y, m, d] = match
  const month = Number(m)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${y}-${m}-${d}`
}

export function parseOfx(content: string): ParseResult {
  if (!/<OFX>/i.test(content)) {
    throw new ImportParseError('That file does not look like an OFX or QFX statement.')
  }

  const warnings: string[] = []
  const currency = ofxValue(content, 'CURDEF') ?? undefined
  const accountHint = ofxValue(content, 'ACCTID') ?? undefined

  const blocks = content.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi) ?? []
  const rows: ParsedRow[] = []

  for (const block of blocks) {
    const postedDate = ofxDate(ofxValue(block, 'DTPOSTED') ?? ofxValue(block, 'DTUSER'))
    const amountRaw = ofxValue(block, 'TRNAMT')
    if (!postedDate || !amountRaw) {
      warnings.push('Skipped a transaction with no date or amount.')
      continue
    }

    let amountMinor: number
    try {
      amountMinor = parseDecimalToMinor(amountRaw, currency ?? 'USD')
    }
    catch {
      warnings.push(`Skipped a transaction with an unreadable amount (${amountRaw}).`)
      continue
    }

    const name = ofxValue(block, 'NAME')
    const memo = ofxValue(block, 'MEMO')
    const payee = ofxValue(block, 'PAYEE') ?? name
    rows.push({
      postedDate,
      amountMinor,
      // Some banks put everything in MEMO and leave NAME empty.
      description: name || memo || '(no description)',
      payee: payee || null,
      memo: memo && memo !== name ? memo : null,
      externalId: ofxValue(block, 'FITID'),
    })
  }

  if (!rows.length && !blocks.length) {
    throw new ImportParseError('No transactions found in that OFX file.')
  }
  return { rows, warnings, currency, accountHint }
}

// ── CSV ───────────────────────────────────────────────────────────────────

/** RFC 4180-ish: quoted fields, doubled quotes, embedded newlines, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  // A BOM in front of the first header breaks exact column-name matching.
  const input = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text

  while (i < input.length) {
    const char = input[i]!
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      field += char; i++; continue
    }
    if (char === '"') { quoted = true; i++; continue }
    if (char === ',') { row.push(field); field = ''; i++; continue }
    if (char === '\r') { i++; continue }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += char; i++
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(cell => cell.trim() !== ''))
}

export type DateOrder = 'auto' | 'MDY' | 'DMY' | 'YMD'

/**
 * Parses a date cell to YYYY-MM-DD with no timezone step anywhere.
 * `auto` resolves what it can from the values themselves; the caller can pin
 * the order when a column is genuinely ambiguous (01/02/2026).
 */
export function parseCsvDate(raw: string, order: DateOrder = 'auto'): string | null {
  const value = raw.trim()
  if (!value) return null

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value)
  if (iso) return isoFrom(iso[1]!, iso[2]!, iso[3]!)

  const parts = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/.exec(value)
  if (!parts) return null
  const [, a, b, c] = parts as unknown as [string, string, string, string]

  if (a.length === 4) return isoFrom(a, b, c) // unambiguous YMD
  const first = Number(a)
  const second = Number(b)

  let resolved: DateOrder = order
  if (resolved === 'auto' || resolved === 'YMD') {
    // >12 in a slot settles it; otherwise US order, which is what a US bank
    // exports. The caller can override, and the preview shows the result.
    if (first > 12) resolved = 'DMY'
    else if (second > 12) resolved = 'MDY'
    else resolved = 'MDY'
  }

  const year = c.length === 2 ? `20${c}` : c.padStart(4, '0')
  return resolved === 'DMY' ? isoFrom(year, b, a) : isoFrom(year, a, b)
}

function isoFrom(y: string, m: string, d: string): string | null {
  const month = Number(m)
  const day = Number(d)
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${y.padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export interface CsvColumnMap {
  date: string
  description: string
  /** Single signed column… */
  amount?: string
  /** …or a debit/credit pair, which plenty of banks use instead. */
  debit?: string
  credit?: string
  payee?: string
  memo?: string
}

/** Best-effort header guess. Always shown to the user for confirmation. */
export function guessColumnMap(header: string[]): Partial<CsvColumnMap> {
  const find = (...patterns: RegExp[]) =>
    header.find(h => patterns.some(p => p.test(h.trim().toLowerCase())))

  const map: Partial<CsvColumnMap> = {}
  const date = find(/^(transaction |posted |post )?date$/, /date/)
  const description = find(/^(description|name|payee|details|transaction)$/, /descript|narrat|details/)
  const amount = find(/^amount$/, /^(transaction )?amount$/, /amount/)
  const debit = find(/^(debit|withdrawal|money out|paid out)/)
  const credit = find(/^(credit|deposit|money in|paid in)/)
  const payee = find(/^(payee|merchant|counterparty)$/)
  const memo = find(/^(memo|notes?|reference)$/)

  if (date) map.date = date
  if (description) map.description = description
  // Prefer an explicit debit/credit pair: when a file has both, "amount" is
  // often an unsigned magnitude and using it would flip half the signs.
  if (debit && credit) { map.debit = debit; map.credit = credit }
  else if (amount) map.amount = amount
  if (payee && payee !== description) map.payee = payee
  if (memo) map.memo = memo
  return map
}

export function parseCsvStatement(content: string, opts: {
  columnMap?: Partial<CsvColumnMap>
  hasHeader?: boolean
  dateFormat?: DateOrder
  currency?: string
}): ParseResult {
  const table = parseCsv(content)
  if (!table.length) throw new ImportParseError('That CSV file is empty.')

  const hasHeader = opts.hasHeader ?? true
  const header = hasHeader ? table[0]!.map(h => h.trim()) : table[0]!.map((_, i) => `Column ${i + 1}`)
  const body = hasHeader ? table.slice(1) : table
  const map = { ...guessColumnMap(header), ...opts.columnMap }

  if (!map.date || !map.description || (!map.amount && !(map.debit || map.credit))) {
    throw new ImportParseError('Tell us which columns hold the date, description, and amount.')
  }

  const index = (name?: string) => (name ? header.indexOf(name) : -1)
  const cols = {
    date: index(map.date),
    description: index(map.description),
    amount: index(map.amount),
    debit: index(map.debit),
    credit: index(map.credit),
    payee: index(map.payee),
    memo: index(map.memo),
  }
  if (cols.date < 0 || cols.description < 0) {
    throw new ImportParseError('Those column names are not in this file.')
  }

  const warnings: string[] = []
  const rows: ParsedRow[] = []
  const currency = opts.currency ?? 'USD'

  for (const [n, cells] of body.entries()) {
    const cell = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '')
    const postedDate = parseCsvDate(cell(cols.date), opts.dateFormat ?? 'auto')
    if (!postedDate) {
      warnings.push(`Row ${n + (hasHeader ? 2 : 1)}: could not read the date.`)
      continue
    }

    let amountMinor: number | null = null
    try {
      if (cols.amount >= 0 && cell(cols.amount)) {
        amountMinor = parseDecimalToMinor(normalizeAmount(cell(cols.amount)), currency)
      }
      else {
        // Debit/credit pair: values are magnitudes, so the sign is ours to set.
        const debit = cell(cols.debit)
        const credit = cell(cols.credit)
        if (debit) amountMinor = -Math.abs(parseDecimalToMinor(normalizeAmount(debit), currency))
        else if (credit) amountMinor = Math.abs(parseDecimalToMinor(normalizeAmount(credit), currency))
      }
    }
    catch {
      amountMinor = null
    }
    if (amountMinor === null) {
      warnings.push(`Row ${n + (hasHeader ? 2 : 1)}: could not read the amount.`)
      continue
    }

    rows.push({
      postedDate,
      amountMinor,
      description: cell(cols.description) || '(no description)',
      payee: cell(cols.payee) || null,
      memo: cell(cols.memo) || null,
      externalId: null,
    })
  }

  if (!rows.length) throw new ImportParseError('No usable rows found in that CSV.')
  return { rows, warnings }
}

/**
 * Strips presentation that banks add to amount cells: currency symbols,
 * thousands separators, and accounting parentheses for negatives. Anything
 * still not a plain decimal afterwards is rejected by the parser rather than
 * guessed at.
 */
function normalizeAmount(raw: string): string {
  let value = raw.trim()
  let negative = false
  if (/^\(.*\)$/.test(value)) { negative = true; value = value.slice(1, -1) }
  value = value.replace(/[^\d.,+-]/g, '')
  // "1.234,56" (European) vs "1,234.56" (US): the LAST separator is decimal.
  const lastComma = value.lastIndexOf(',')
  const lastDot = value.lastIndexOf('.')
  if (lastComma > lastDot) value = value.replace(/\./g, '').replace(',', '.')
  else value = value.replace(/,/g, '')
  if (value.startsWith('-')) { negative = !negative; value = value.slice(1) }
  if (value.startsWith('+')) value = value.slice(1)
  return negative ? `-${value}` : value
}

export function detectFormat(filename: string, content: string): 'ofx' | 'qfx' | 'csv' {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.qfx')) return 'qfx'
  if (lower.endsWith('.ofx')) return 'ofx'
  if (lower.endsWith('.csv')) return 'csv'
  return /<OFX>/i.test(content) ? 'ofx' : 'csv'
}
