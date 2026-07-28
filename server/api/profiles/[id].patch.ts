import { profilePatchSchema } from '#shared/schemas/profiles'
import { useDb } from '../../db/client'
import { updateProfile } from '../../services/profiles/store'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const patch = await readValidatedBody(event, profilePatchSchema.parse)
  // Used to return the raw updated row — including pinHash, the argon2 hash of
  // the Money PIN — to anyone who could make themselves admin, which is a tap.
  return updateProfile(useDb(), id, patch)
})
