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

/**
 * A non-fatal problem worth telling the user about, as a code plus its
 * parameters rather than a finished sentence.
 *
 * These are payload data, not `statusMessage` strings — they land in the
 * import review step and get read by whoever is importing, so they have to
 * arrive in the board's language. The server has no idea what that is, so it
 * ships the code and the client renders `finance.import.warnings.<code>`.
 */
export interface ImportWarning {
  code:
    | 'noDateOrAmount' // OFX transaction missing DTPOSTED or TRNAMT
    | 'unreadableAmount' // OFX TRNAMT that is not a number
    | 'badDate' // CSV row whose date cell would not parse
    | 'badAmount' // CSV row whose amount cell(s) would not parse
  /** 1-based line number as the user's spreadsheet shows it. CSV codes only. */
  row?: number
  /** The cell text that could not be read. `unreadableAmount` only. */
  amount?: string
}

export interface ParseResult {
  rows: ParsedRow[]
  /** Non-fatal problems worth telling the user about. */
  warnings: ImportWarning[]
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

  const warnings: ImportWarning[] = []
  const currency = ofxValue(content, 'CURDEF') ?? undefined
  const accountHint = ofxValue(content, 'ACCTID') ?? undefined

  // Some banks export every account in one download. Transactions are scanned
  // from the whole document, so importing that into the single account the
  // user picked would silently merge two accounts' history — and undoing the
  // batch afterwards cannot tell them apart again. Refuse instead.
  const accountIds = new Set(
    [...content.matchAll(/<ACCTID>([^<]*)/gi)]
      .map(m => m[1]!.trim())
      .filter(Boolean),
  )
  if (accountIds.size > 1) {
    throw new ImportParseError(
      `That file covers more than one account (${[...accountIds].length} of them). `
      + 'Download a statement for a single account and import it on its own.',
    )
  }

  const blocks = content.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi) ?? []
  const rows: ParsedRow[] = []

  for (const block of blocks) {
    const postedDate = ofxDate(ofxValue(block, 'DTPOSTED') ?? ofxValue(block, 'DTUSER'))
    const amountRaw = ofxValue(block, 'TRNAMT')
    if (!postedDate || !amountRaw) {
      warnings.push({ code: 'noDateOrAmount' })
      continue
    }

    let amountMinor: number
    try {
      amountMinor = parseDecimalToMinor(amountRaw, currency ?? 'USD')
    }
    catch {
      warnings.push({ code: 'unreadableAmount', amount: amountRaw })
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
    // A quote only opens a quoted field at the START of one. Mid-field it is
    // literal text — `5" PIPE FITTING` is a real description, and treating its
    // quote as an opener swallows every remaining row in the statement.
    if (char === '"' && field === '') { quoted = true; i++; continue }
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

/**
 * Decides the day/month order ONCE for a whole file.
 *
 * Resolving per row is what makes a UK statement land half in January and half
 * scattered across the year: "15/01" is unambiguously DMY, but "05/01" on its
 * own looks like US order and silently becomes 5 May. One unambiguous row is
 * evidence about every other row in the same file.
 */
export function resolveDateOrder(values: string[], requested: DateOrder = 'auto'): DateOrder {
  if (requested !== 'auto') return requested

  let sawDayFirst = false
  let sawMonthFirst = false
  for (const raw of values) {
    const parts = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/.exec(raw.trim())
    if (!parts || parts[1]!.length === 4) continue
    if (Number(parts[1]) > 12) sawDayFirst = true
    else if (Number(parts[2]) > 12) sawMonthFirst = true
  }

  // If the file contradicts itself, neither order is right for every row —
  // fall back to US order and let the preview show the user what happened.
  if (sawDayFirst && !sawMonthFirst) return 'DMY'
  return 'MDY'
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

  const warnings: ImportWarning[] = []
  const rows: ParsedRow[] = []
  const currency = opts.currency ?? 'USD'

  // Decided once for the whole file: one unambiguous row ("15/01") is evidence
  // about every other row in it. Resolving per row sends "05/01" to May while
  // its neighbour goes to January.
  const dateOrder = resolveDateOrder(
    body.map(cells => (cols.date >= 0 ? (cells[cols.date] ?? '') : '')),
    opts.dateFormat ?? 'auto',
  )

  for (const [n, cells] of body.entries()) {
    const cell = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '')
    const postedDate = parseCsvDate(cell(cols.date), dateOrder)
    if (!postedDate) {
      warnings.push({ code: 'badDate', row: n + (hasHeader ? 2 : 1) })
      continue
    }

    let amountMinor: number | null = null
    try {
      if (cols.amount >= 0 && cell(cols.amount)) {
        amountMinor = parseDecimalToMinor(normalizeAmount(cell(cols.amount)), currency)
      }
      else {
        // Debit/credit pair: the values are magnitudes, so the sign is ours to
        // set. Plenty of banks write "0.00" in the column that doesn't apply
        // rather than leaving it blank — so pick the column with a NON-ZERO
        // value, not merely a non-empty one. Choosing on emptiness turns a
        // £2,450 salary into zero, and nothing downstream would flag it.
        const parse = (text: string) =>
          text ? Math.abs(parseDecimalToMinor(normalizeAmount(text), currency)) : 0
        const debit = parse(cell(cols.debit))
        const credit = parse(cell(cols.credit))
        if (debit) amountMinor = -debit
        else if (credit) amountMinor = credit
        // Both zero: a real zero-value row (an adjustment), not a parse failure.
        else if (cell(cols.debit) || cell(cols.credit)) amountMinor = 0
      }
    }
    catch {
      amountMinor = null
    }
    if (amountMinor === null) {
      warnings.push({ code: 'badAmount', row: n + (hasHeader ? 2 : 1) })
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

  const lastComma = value.lastIndexOf(',')
  const lastDot = value.lastIndexOf('.')

  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: whichever comes last is the decimal separator.
    // "1,234.56" (US) vs "1.234,56" (European).
    if (lastComma > lastDot) value = value.replace(/\./g, '').replace(',', '.')
    else value = value.replace(/,/g, '')
  }
  else if (lastComma >= 0) {
    // Only commas. "12,50" is a European decimal; "1,234" is a US thousands
    // separator. The tell is the digit count after the LAST comma: a decimal
    // fraction is 1-2 digits, a thousands group is always exactly 3.
    // Reading "1,234" as 1.234 divides a statement line by a thousand, and
    // nothing downstream would ever notice.
    const tail = value.slice(lastComma + 1)
    if (tail.length === 3) value = value.replace(/,/g, '')
    else value = value.replace(',', '.')
  }

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
