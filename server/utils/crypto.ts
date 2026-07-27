import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './dataDir'

/**
 * Encryption at rest for third-party credentials — currently the SimpleFIN
 * access URL, which embeds live basic-auth credentials for someone's bank data.
 * The SimpleFIN spec requires storing it "at least as securely as the user's
 * financial data", and nothing else in this app is encrypted, so this is the
 * first crypto utility here.
 *
 * WHAT THIS PROTECTS: a copy of betts.db. That matters because copying the
 * database *is* the documented backup path (docker-compose.yml advertises
 * `docker cp betts.db`), and those copies end up on laptops and in cloud drives.
 *
 * WHAT IT DOES NOT PROTECT: the key lives in the same volume as the database,
 * so anyone who takes the whole volume, or who gets into the container, has
 * both halves. Self-hosting can't do better without asking for a passphrase on
 * every boot. Say this plainly in the UI rather than implying more.
 *
 * The key is deliberately NOT derived from NUXT_SESSION_PASSWORD: a self-hoster
 * may legitimately rotate that, and it would silently make every stored
 * credential undecryptable with no path back.
 */

const KEY_FILE = '.finance-key'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // GCM standard
const VERSION = 'v1'

let cachedKey: Buffer | null = null

/** Reads the key, creating it on first use. Owner-readable only. */
function key(): Buffer {
  if (cachedKey) return cachedKey
  const path = join(dataDir(), KEY_FILE)
  if (existsSync(path)) {
    const raw = readFileSync(path)
    // Stored base64 so the file stays greppable/diffable as text.
    const parsed = Buffer.from(raw.toString('utf8').trim(), 'base64')
    if (parsed.length !== 32) {
      throw new Error(`${KEY_FILE} is not a 32-byte key — refusing to guess`)
    }
    cachedKey = parsed
  }
  else {
    const fresh = randomBytes(32)
    writeFileSync(path, fresh.toString('base64'), { mode: 0o600 })
    try {
      chmodSync(path, 0o600)
    }
    catch { /* best effort — some filesystems don't support it */ }
    cachedKey = fresh
  }
  return cachedKey
}

/** Only for tests, which use a throwaway data dir per case. */
export function resetKeyCache() {
  cachedKey = null
}

/**
 * Returns a versioned envelope: `v1.<iv>.<tag>.<ciphertext>`, all base64.
 * Versioned so the algorithm or key can change without a migration guess.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.')
}

/**
 * Returns null for anything that doesn't decrypt cleanly — tampered ciphertext,
 * a rotated key, a truncated column, an envelope from a future version. Callers
 * degrade to "reconnect your bank"; a thrown error here would take out an
 * unrelated page.
 */
export function decryptSecret(envelope: string | null | undefined): string | null {
  if (!envelope) return null
  const parts = envelope.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) return null
  const [, ivB64, tagB64, dataB64] = parts

  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64!, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64!, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64!, 'base64')),
      decipher.final(), // throws if the GCM tag doesn't verify
    ]).toString('utf8')
  }
  catch {
    return null
  }
}
