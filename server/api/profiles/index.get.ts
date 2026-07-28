import { useDb } from '../../db/client'
import { listProfiles } from '../../services/profiles/store'
import { requireUnlocked } from '../../utils/session'

// No route under server/api/profiles/ imports the `profiles` table: every read
// and write goes through the store, which selects an allowlist of columns. A
// route cannot leak the Money PIN hash it never had the chance to select.
export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  return listProfiles(useDb())
})
