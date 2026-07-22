import { mkdirSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'

let _dataDir: string | null = null

/** Absolute path of the persistent data directory (db + uploads). Created on first use. */
export function dataDir(): string {
  if (!_dataDir) {
    const configured = process.env.BETTS_DATA_DIR || useRuntimeConfig().dataDir || '.data'
    _dataDir = isAbsolute(configured) ? configured : join(process.cwd(), configured)
    mkdirSync(_dataDir, { recursive: true })
  }
  return _dataDir
}

export function uploadsDir(...segments: string[]): string {
  const dir = join(dataDir(), 'uploads', ...segments)
  mkdirSync(dir, { recursive: true })
  return dir
}
