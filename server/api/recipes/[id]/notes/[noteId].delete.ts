import { useDb } from '../../../../db/client'
import { deleteNote } from '../../../../services/recipes/recipes'
import { requireHousehold, requireProfile } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const noteId = getRouterParam(event, 'noteId')!
  const hh = requireHousehold()
  return deleteNote(useDb(), hh.id, id, noteId, { id: profile.id, role: profile.role })
})
