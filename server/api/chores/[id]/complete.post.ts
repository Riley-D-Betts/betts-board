import { choreCompleteSchema } from '#shared/schemas/chores'
import { useDb } from '../../../db/client'
import { completeChore } from '../../../services/chores/board'
import { requireProfile } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const choreId = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, choreCompleteSchema.parse)

  // Kids may only check off their own instances; adults can check off anyone's.
  if (profile.role === 'kid' && body.profileId !== profile.id) {
    throw createError({ statusCode: 403, statusMessage: 'You can only complete your own chores' })
  }

  return completeChore(useDb(), {
    choreId,
    profileId: body.profileId,
    dueDate: body.dueDate,
    completedByProfileId: profile.id,
  })
})
