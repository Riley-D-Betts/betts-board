import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createError } from 'h3'
import { SafeFetchError, safeFetch } from '../../utils/safeFetch'

/**
 * Downloads a Google Font once and serves it from this server forever after.
 *
 * The board is meant to work on a LAN with no internet, and a page that pulls
 * fonts from Google on every view would both break that and hand Google a log
 * of every time the family looks at the fridge display. So: fetch once, store
 * in the data volume, serve locally.
 *
 * Security posture — the only place the app fetches a user-influenced URL:
 *  - the user supplies a family *name*, never a URL, and it is validated
 *    against a strict charset before use
 *  - the request host is a hardcoded constant, so no part of the URL's
 *    authority comes from user input (there is nothing to SSRF)
 *  - redirects are refused outright
 *  - every font URL found in the response must be https and *exactly*
 *    fonts.gstatic.com (equality, not suffix — fonts.gstatic.com.evil.test
 *    must not pass)
 *  - downloaded bytes must start with the woff2 magic number
 *  - we regenerate our own CSS from parsed values and never serve Google's
 *    CSS text, which forecloses @import and url(javascript:) injection
 *  - every request goes out through safeFetch(), which caps the response
 *    while it streams and holds one time budget across the body read
 */

const CSS_HOST = 'https://fonts.googleapis.com'
const FONT_HOST = 'fonts.gstatic.com'
// Google serves ttf to unrecognised agents and woff2 to modern browsers.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const WEIGHTS = '400;500;600;700'
const TIMEOUT_MS = 10_000
const MAX_CSS_BYTES = 200_000
const MAX_FILES = 12
const MAX_TOTAL_BYTES = 2_000_000

export interface FontFace {
  style: string
  weight: string
  unicodeRange: string | null
  url: string
}

export function slugifyFamily(family: string): string {
  return family.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Only the latin subsets — enough for this app, and a fraction of the bytes. */
function isLatinSubset(face: FontFace): boolean {
  // The latin and latin-ext blocks are the ones covering basic ASCII.
  return face.unicodeRange === null || face.unicodeRange.includes('U+0000-00FF')
    || face.unicodeRange.includes('U+0100-02AF')
}

export function parseFontFaces(css: string): FontFace[] {
  const faces: FontFace[] = []
  for (const block of css.split('@font-face').slice(1)) {
    const body = block.slice(0, block.indexOf('}') + 1)
    const url = /src:[^;]*url\((https:\/\/[^)]+\.woff2)\)/.exec(body)?.[1]
    if (!url) continue
    faces.push({
      style: /font-style:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? 'normal',
      weight: /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '400',
      unicodeRange: /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? null,
      url,
    })
  }
  return faces
}

/** Throws unless the URL is https and exactly on fonts.gstatic.com. */
export function assertFontUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw createError({ statusCode: 422, statusMessage: 'Malformed font URL' })
  }
  if (url.protocol !== 'https:' || url.hostname !== FONT_HOST) {
    throw createError({ statusCode: 422, statusMessage: 'Font URL is not on fonts.gstatic.com' })
  }
  return url
}

function isWoff2(bytes: Uint8Array): boolean {
  // 'wOF2'
  return bytes.length > 4 && bytes[0] === 0x77 && bytes[1] === 0x4F
    && bytes[2] === 0x46 && bytes[3] === 0x32
}

/**
 * Everything goes through safeFetch: not because the host is attacker-chosen
 * (it isn't — see the posture note above) but for the other half of the job.
 * The old timer here was cleared the moment the headers arrived, so the size
 * checks below ran on bytes we had ALREADY buffered — a server that dribbles
 * out an endless response filled this container's memory whatever the caps
 * said. safeFetch counts as it streams and aborts mid-body, and its budget
 * covers the read.
 *
 * `maxRedirects: 0` keeps the previous `redirect: 'error'` posture: Google
 * serves these directly, so a hop means something is in the middle.
 */
async function fetchFont(url: string, maxBytes: number) {
  return safeFetch(url, {
    timeoutMs: TIMEOUT_MS,
    maxBytes,
    maxRedirects: 0,
    headers: { 'User-Agent': UA },
  })
}

/** Base URL override so tests, and self-hosters with a local mirror, can point
 *  elsewhere. A mirror on the LAN also needs its host in
 *  BETTS_ALLOW_PRIVATE_FETCH_HOSTS — safeFetch has no exception for us. */
function cssHost() {
  return process.env.BETTS_GOOGLE_FONTS_URL || CSS_HOST
}

export async function fetchFamilyCss(family: string): Promise<string> {
  const url = `${cssHost()}/css2?family=${encodeURIComponent(family)}:wght@${WEIGHTS}&display=swap`
  let response: Awaited<ReturnType<typeof fetchFont>>
  try {
    response = await fetchFont(url, MAX_CSS_BYTES)
  }
  catch (err) {
    if (err instanceof SafeFetchError && err.reason === 'too-large') {
      throw createError({ statusCode: 422, statusMessage: 'That font is unexpectedly large' })
    }
    throw createError({
      statusCode: 502,
      statusMessage: 'Could not reach Google Fonts — this board needs internet access once to download a font.',
    })
  }
  if (response.status === 400 || response.status === 404) {
    throw createError({ statusCode: 422, statusMessage: `No Google Font named "${family}"` })
  }
  if (!response.ok) {
    throw createError({ statusCode: 502, statusMessage: 'Google Fonts returned an error' })
  }
  return new TextDecoder().decode(response.bytes)
}

/** Our own stylesheet, built from parsed values — never Google's text. */
export function generateCss(family: string, slug: string, files: { file: string, face: FontFace }[]): string {
  const blocks = files.map(({ file, face }) => [
    '@font-face {',
    `  font-family: '${family.replace(/'/g, '')}';`,
    `  font-style: ${face.style};`,
    `  font-weight: ${face.weight};`,
    '  font-display: swap;',
    `  src: url(/fonts/${slug}/${file}) format('woff2');`,
    ...(face.unicodeRange ? [`  unicode-range: ${face.unicodeRange};`] : []),
    '}',
  ].join('\n'))
  // The variable is what makes the family reachable from the font registry.
  blocks.push(`:root { --betts-custom-font: '${family.replace(/'/g, '')}'; }`)
  return `${blocks.join('\n\n')}\n`
}

export interface DownloadedFont {
  family: string
  slug: string
  version: string
}

/**
 * Fetches the family and writes woff2 files plus a generated font.css into
 * `targetDir/<slug>/`. Returns what the household settings should record.
 */
export async function downloadGoogleFont(family: string, targetDir: string): Promise<DownloadedFont> {
  const css = await fetchFamilyCss(family)
  const faces = parseFontFaces(css).filter(isLatinSubset)
  if (!faces.length) {
    throw createError({ statusCode: 422, statusMessage: `No usable font files for "${family}"` })
  }

  const slug = slugifyFamily(family)
  if (!slug) throw createError({ statusCode: 422, statusMessage: 'Unusable font name' })

  const selected = faces.slice(0, MAX_FILES)
  const written: { file: string, face: FontFace }[] = []
  const hash = createHash('sha256')
  let total = 0

  const dir = join(targetDir, slug)
  // Replace any previous download of the same family outright.
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  for (const [index, face] of selected.entries()) {
    assertFontUrl(face.url)
    // The remaining budget is the cap for this file, so the total can never be
    // exceeded by buffering one more file first — the stream stops at the line.
    const response = await fetchFont(face.url, MAX_TOTAL_BYTES - total).catch((err) => {
      if (err instanceof SafeFetchError && err.reason === 'too-large') {
        throw createError({ statusCode: 422, statusMessage: 'That font is unexpectedly large' })
      }
      throw createError({ statusCode: 502, statusMessage: 'Could not download the font files' })
    })
    if (!response.ok) {
      throw createError({ statusCode: 502, statusMessage: 'Could not download the font files' })
    }
    const bytes = response.bytes
    if (!isWoff2(bytes)) {
      throw createError({ statusCode: 422, statusMessage: 'Downloaded file was not a woff2 font' })
    }
    total += bytes.byteLength
    // Filenames are ours, never derived from the remote URL.
    const file = `${index}.woff2`
    writeFileSync(join(dir, file), bytes)
    hash.update(bytes)
    written.push({ file, face })
  }

  writeFileSync(join(dir, 'font.css'), generateCss(family, slug, written))
  return { family: family.trim(), slug, version: hash.digest('hex').slice(0, 12) }
}
