import { choreCompleteSchema } from '#shared/schemas/chores'
import { useDb } from '../../../db/client'
import { uncompleteChore } from '../../../services/chores/board'
import { requireProfile } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const choreId = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, choreCompleteSchema.parse)

  if (profile.role === 'kid' && body.profileId !== profile.id) {
    throw createError({ statusCode: 403, statusMessage: 'You can only undo your own chores' })
  }

  return uncompleteChore(useDb(), {
    choreId,
    profileId: body.profileId,
    dueDate: body.dueDate,
  })
})
