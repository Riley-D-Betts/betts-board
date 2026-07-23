import { feedbackCreateSchema } from '#shared/schemas/feedback'
import { useDb } from '../../db/client'
import { createIssue } from '../../services/feedback/github'
import { checkRateLimit } from '../../utils/rateLimit'
import { requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  if (!checkRateLimit(`feedback:${profile.id}`, 5, 1)) {
    throw createError({ statusCode: 429, statusMessage: 'Whoa, that\'s a lot of feedback — try again in a minute' })
  }

  const input = await readValidatedBody(event, feedbackCreateSchema.parse)
  return createIssue(useDb(), {
    kind: input.kind,
    title: input.title,
    body: input.body,
    reporterName: profile.name,
    diagnostics: input.kind === 'bug' && input.includeDiagnostics ? input.diagnostics : undefined,
  })
})
