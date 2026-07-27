import type { H3Event } from 'h3'
import { createError } from 'h3'
import { defu } from 'defu'

/**
 * Nitro auto-imports `createError`, `getUserSession` and `setUserSession` into
 * server code; plain vitest has no such magic. This provides them as globals.
 *
 * The session stub uses the REAL defu, merging exactly the way
 * nuxt-auth-utils does (`session.update(defu(data, session.data))`). That is
 * deliberate: the finance access model exists *because* of those merge
 * semantics, so a stub that merged more sensibly would test a system we don't
 * ship.
 */

export interface FakeEvent {
  context: Record<string, unknown>
  /** The sealed-cookie contents, in the shape nuxt-auth-utils stores. */
  sessionData: Record<string, unknown>
}

export function installNitroGlobals() {
  const g = globalThis as Record<string, unknown>
  g.createError = createError
  g.getUserSession = async (event: FakeEvent) => event.sessionData
  g.setUserSession = async (event: FakeEvent, data: Record<string, unknown>) => {
    event.sessionData = defu(data, event.sessionData) as Record<string, unknown>
    return event.sessionData
  }
  g.clearUserSession = async (event: FakeEvent) => {
    event.sessionData = {}
  }
}

export function makeEvent(session: Record<string, unknown> = {}): H3Event {
  return { context: {}, sessionData: session } as unknown as H3Event
}

/** Mirrors setBoardSession: writes under `user`, merged with defu. */
export async function setBoard(event: H3Event, user: Record<string, unknown>) {
  const g = globalThis as Record<string, unknown>
  await (g.setUserSession as (e: H3Event, d: unknown) => Promise<unknown>)(event, { user })
}

export function sessionOf(event: H3Event): Record<string, unknown> {
  return (event as unknown as FakeEvent).sessionData
}
