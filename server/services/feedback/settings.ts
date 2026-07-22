import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import type { FeedbackStatus } from '#shared/schemas/feedback'
import type { Db } from '../../db/client'
import { households } from '../../db/schema'

/** What the client may know: whether feedback works, and where — never the token. */
export function getFeedbackStatus(db: Db): FeedbackStatus {
  const hh = db.select({
    githubRepo: households.githubRepo,
    githubToken: households.githubToken,
  }).from(households).limit(1).get()
  return {
    configured: Boolean(hh?.githubRepo && hh.githubToken),
    repo: hh?.githubRepo ?? null,
  }
}

export interface FeedbackSettingsInput {
  repo: string | null
  /** Omitted = keep the stored token; a string replaces it; null clears it. */
  token?: string | null
}

/** Connect, re-point, or disconnect the GitHub repo. `repo: null` clears both. */
export function updateFeedbackSettings(db: Db, input: FeedbackSettingsInput): FeedbackStatus {
  const hh = db.select({ id: households.id }).from(households).limit(1).get()
  if (!hh) throw createError({ statusCode: 409, statusMessage: 'Setup required' })

  db.update(households).set(
    input.repo === null
      ? { githubRepo: null, githubToken: null }
      : {
          githubRepo: input.repo,
          ...(input.token !== undefined && { githubToken: input.token }),
        },
  ).where(eq(households.id, hh.id)).run()

  return getFeedbackStatus(db)
}
