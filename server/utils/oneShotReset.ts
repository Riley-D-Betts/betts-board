import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './dataDir'

/**
 * Values that mean "off". The plugins used to demand exactly `1`, so widening
 * to "any value re-arms" must not turn the obvious ways of writing *disabled*
 * into a live arming: `BETTS_RESET_PASSWORD: "no"` left in a compose file is
 * meant to keep the board shut, not to clear the household password on the
 * next boot and hand it to whoever reaches it first.
 */
const DISARMED = new Set(['', '0', 'false', 'no', 'off'])

/**
 * Arming for the break-glass reset env vars (`BETTS_RESET_PASSWORD`,
 * `BETTS_RESET_FINANCE_PIN`).
 *
 * The documentation says "set it for one boot, then remove it", but nothing
 * used to enforce that, and the natural place to put it is
 * `docker-compose.yml` — where it then stays. Every restart, crash-loop, or
 * image update afterwards silently cleared the household password again, so a
 * board that some households expose to the internet reopened itself to
 * whoever reached it first. A one-time recovery action must not become a
 * standing one.
 *
 * So the consumed value is recorded in the data volume (the same place that
 * survives `docker compose up -d --build`, unlike anything in memory) and the
 * reset refuses to run again until an operator either removes the variable —
 * which re-arms it for next time — or gives it a different value.
 *
 * Returns true at most once per arming; the caller then performs the reset.
 */
export function claimOneShotReset(envVar: string): boolean {
  const value = process.env[envVar]?.trim() ?? ''
  const armed = !DISARMED.has(value.toLowerCase())
  const marker = join(dataDir(), `.${envVar.toLowerCase().replaceAll('_', '-')}.done`)
  const consumed = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null

  if (!armed) {
    if (consumed !== null) {
      rmSync(marker, { force: true })
      console.warn(`[betts-board] ${envVar} is no longer set — re-armed; it will act again on the next boot that sets it.`)
    }
    return false
  }

  if (consumed === value) {
    console.warn(
      `[betts-board] IGNORING ${envVar}=${value}: it was already carried out on an earlier boot. `
      + 'Remove it from your environment (docker-compose.yml) — left in place it would reset on every restart. '
      + 'To run it again, unset it for one boot, or give it a different value.',
    )
    return false
  }

  try {
    // Recorded BEFORE acting, deliberately: if the volume is read-only or full
    // we cannot promise "once", and a reset that quietly repeats on every boot
    // is far worse than a reset that does not happen and says so.
    writeFileSync(marker, `${value}\n`, { mode: 0o600 })
  }
  catch (error) {
    console.error(
      `[betts-board] IGNORING ${envVar}: could not record it as used at ${marker} `
      + `(${(error as Error).message}). Refusing to run a reset that could not be limited to one boot.`,
    )
    return false
  }
  return true
}
