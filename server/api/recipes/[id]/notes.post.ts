import { recipeNoteCreateSchema } from '#shared/schemas/recipes'
import { useDb } from '../../../db/client'
import { addNote } from '../../../services/recipes/recipes'
import { requireHousehold, requireProfile } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const { body } = await readValidatedBody(event, recipeNoteCreateSchema.parse)
  const hh = requireHousehold()
  return addNote(useDb(), hh.id, id, profile.id, body)
})
