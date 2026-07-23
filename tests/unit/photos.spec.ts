import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import sharp from 'sharp'
import { createDb, type Db } from '../../server/db/client'
import { defaultHouseholdSettings, households } from '../../server/db/schema'
import {
  deletePhoto, getPhoto, isHeifContainer, listPhotos, listSlideshowPhotos,
  parseExifTakenAt, savePhoto, setInSlideshow, shuffle, toPhotoDto,
} from '../../server/services/photos/store'
import { describeWeatherCode } from '../../server/services/weather/forecast'

// Point uploadsDir() at a throwaway directory before any service call.
const TEST_DATA_DIR = join(tmpdir(), `betts-photos-spec-${process.pid}`)
process.env.BETTS_DATA_DIR = TEST_DATA_DIR
afterAll(() => rmSync(TEST_DATA_DIR, { recursive: true, force: true }))

let db: Db
let householdId: string

beforeEach(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  householdId = db.insert(households).values({
    name: 'Test',
    passwordHash: 'x',
    timezone: 'America/Boise',
    icsToken: 'tok',
    settings: defaultHouseholdSettings,
  }).returning().get().id
})

function makeJpeg(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 60, b: 60 } },
  }).jpeg().toBuffer()
}

describe('parseExifTakenAt', () => {
  it('finds the YYYY:MM:DD HH:MM:SS pattern in a raw EXIF blob', () => {
    const buf = Buffer.concat([
      Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d]),
      Buffer.from('junk 2021:05:04 09:08:07 more junk', 'latin1'),
    ])
    expect(parseExifTakenAt(buf)).toEqual(new Date(2021, 4, 4, 9, 8, 7))
  })

  it('returns null when there is no datetime pattern', () => {
    expect(parseExifTakenAt(Buffer.from('no dates here 1234:56'))).toBeNull()
    expect(parseExifTakenAt(undefined)).toBeNull()
    expect(parseExifTakenAt(Buffer.alloc(0))).toBeNull()
  })

  it('rejects implausible dates', () => {
    expect(parseExifTakenAt(Buffer.from('0000:00:00 00:00:00'))).toBeNull()
    expect(parseExifTakenAt(Buffer.from('2021:13:04 09:08:07'))).toBeNull()
    expect(parseExifTakenAt(Buffer.from('2021:05:04 25:08:07'))).toBeNull()
  })
})

describe('savePhoto', () => {
  it('re-encodes to a bounded jpeg + thumb and inserts the row', async () => {
    const row = await savePhoto(db, {
      householdId,
      profileId: null,
      buffer: await makeJpeg(3000, 2000),
      originalName: 'big.jpg',
    })

    expect(row.width).toBe(2560)
    expect(row.height).toBeGreaterThanOrEqual(1706)
    expect(row.height).toBeLessThanOrEqual(1707)
    expect(row.path).toMatch(/^photos\/[0-9a-f-]+\.jpg$/)
    expect(row.thumbPath).toMatch(/^photos\/thumbs\/[0-9a-f-]+\.jpg$/)
    expect(row.inSlideshow).toBe(true)
    expect(row.takenAt).toBeNull() // generated image has no EXIF
    expect(row.sizeBytes).toBeGreaterThan(0)
    expect(existsSync(join(TEST_DATA_DIR, 'uploads', row.path))).toBe(true)
    expect(existsSync(join(TEST_DATA_DIR, 'uploads', row.thumbPath))).toBe(true)

    const main = await sharp(join(TEST_DATA_DIR, 'uploads', row.path)).metadata()
    expect(main.width).toBe(2560)
    const thumb = await sharp(join(TEST_DATA_DIR, 'uploads', row.thumbPath)).metadata()
    expect(thumb.width).toBe(480)
  })

  it('never enlarges small photos', async () => {
    const row = await savePhoto(db, {
      householdId,
      profileId: null,
      buffer: await makeJpeg(300, 200),
    })
    expect(row.width).toBe(300)
    expect(row.height).toBe(200)
  })

  it('throws 415 for an undecodable buffer', async () => {
    await expect(savePhoto(db, {
      householdId,
      profileId: null,
      buffer: Buffer.from('definitely not an image'),
      originalName: 'nope.jpg',
    })).rejects.toMatchObject({ statusCode: 415 })
  })

  // Generous timeout: the first decode instantiates the libheif WASM bundle,
  // which takes several seconds on a cold cache (always the case in CI).
  it('decodes HEVC-coded HEIF (phone HEIC) via the wasm fallback', { timeout: 30_000 }, async () => {
    const buf = readFileSync(join(__dirname, '../fixtures/sample.heic'))
    // Guard: prebuilt sharp must NOT decode this directly, or the fallback
    // path silently stops being exercised.
    await expect(sharp(buf).jpeg().toBuffer()).rejects.toThrow()

    const row = await savePhoto(db, {
      householdId,
      profileId: null,
      buffer: buf,
      originalName: 'autumn.heic',
    })
    expect(row.width).toBe(1440)
    expect(row.height).toBe(960)
    const main = await sharp(join(TEST_DATA_DIR, 'uploads', row.path)).metadata()
    expect(main.format).toBe('jpeg')
    expect(main.width).toBe(1440)
  })

  it('throws 415 for a HEIF container with garbage payload', async () => {
    const fake = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheic', 'latin1'),
      Buffer.alloc(64, 7),
    ])
    await expect(savePhoto(db, {
      householdId,
      profileId: null,
      buffer: fake,
      originalName: 'broken.heic',
    })).rejects.toMatchObject({ statusCode: 415 })
  })
})

describe('isHeifContainer', () => {
  it('recognizes ftyp brands of the HEIF family', () => {
    for (const brand of ['heic', 'heix', 'mif1', 'avif']) {
      const buf = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}rest`, 'latin1')])
      expect(isHeifContainer(buf)).toBe(true)
    }
  })

  it('rejects other files', () => {
    expect(isHeifContainer(Buffer.from('GIF89a and then some content'))).toBe(false)
    expect(isHeifContainer(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom....', 'latin1')]))).toBe(false)
    expect(isHeifContainer(Buffer.from([0xFF, 0xD8, 0xFF]))).toBe(false)
    expect(isHeifContainer(Buffer.alloc(0))).toBe(false)
  })
})

describe('listPhotos / setInSlideshow / deletePhoto', () => {
  it('paginates newest-first with the id cursor', async () => {
    const a = await savePhoto(db, { householdId, profileId: null, buffer: await makeJpeg(120, 80) })
    const b = await savePhoto(db, { householdId, profileId: null, buffer: await makeJpeg(120, 80) })
    const c = await savePhoto(db, { householdId, profileId: null, buffer: await makeJpeg(120, 80) })

    const page1 = listPhotos(db, { householdId, limit: 2 })
    expect(page1.map(p => p.id)).toEqual([c.id, b.id])

    const page2 = listPhotos(db, { householdId, cursor: page1.at(-1)!.id, limit: 2 })
    expect(page2.map(p => p.id)).toEqual([a.id])
  })

  it('toggles slideshow membership and filters the slideshow list', async () => {
    const a = await savePhoto(db, { householdId, profileId: null, buffer: await makeJpeg(120, 80) })
    const b = await savePhoto(db, { householdId, profileId: null, buffer: await makeJpeg(120, 80) })

    setInSlideshow(db, householdId, a.id, false)
    expect(listSlideshowPhotos(db, householdId).map(p => p.id)).toEqual([b.id])
    expect(() => setInSlideshow(db, householdId, 'missing', true)).toThrowError()
  })

  it('deletePhoto removes files and the row', async () => {
    const row = await savePhoto(db, { householdId, profileId: null, buffer: await makeJpeg(120, 80) })
    expect(deletePhoto(db, householdId, row.id)).toEqual({ ok: true })
    expect(getPhoto(db, householdId, row.id)).toBeNull()
    expect(existsSync(join(TEST_DATA_DIR, 'uploads', row.path))).toBe(false)
    expect(existsSync(join(TEST_DATA_DIR, 'uploads', row.thumbPath))).toBe(false)
    expect(() => deletePhoto(db, householdId, row.id)).toThrowError()
  })

  it('toPhotoDto maps to /uploads urls and epoch-ms timestamps', async () => {
    const row = await savePhoto(db, { householdId, profileId: null, buffer: await makeJpeg(120, 80) })
    const dto = toPhotoDto(row)
    expect(dto.url).toBe(`/uploads/${row.path}`)
    expect(dto.thumbUrl).toBe(`/uploads/${row.thumbPath}`)
    expect(dto.uploadedAt).toBe(row.uploadedAt.getTime())
    expect(dto.takenAt).toBeNull()
  })
})

describe('shuffle', () => {
  it('keeps the same members and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = shuffle(input)
    expect([...out].sort((x, y) => x - y)).toEqual(input)
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe('describeWeatherCode', () => {
  it('maps WMO codes to icon + label buckets', () => {
    expect(describeWeatherCode(0)).toEqual({ icon: 'i-lucide-sun', label: 'Clear' })
    expect(describeWeatherCode(2).icon).toBe('i-lucide-cloud-sun')
    expect(describeWeatherCode(3).icon).toBe('i-lucide-cloud')
    expect(describeWeatherCode(45).icon).toBe('i-lucide-cloud-fog')
    expect(describeWeatherCode(53).label).toBe('Drizzle')
    expect(describeWeatherCode(63).label).toBe('Rain')
    expect(describeWeatherCode(81).label).toBe('Rain')
    expect(describeWeatherCode(75).label).toBe('Snow')
    expect(describeWeatherCode(86).label).toBe('Snow')
    expect(describeWeatherCode(95).label).toBe('Thunderstorm')
    expect(describeWeatherCode(42).icon).toBe('i-lucide-cloud') // unknown → cloudy
  })
})
