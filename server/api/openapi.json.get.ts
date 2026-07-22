import { buildOpenApiSpec } from '../services/apiDocs/spec'
import { requireUnlocked } from '../utils/session'

// The document is generated from the same zod schemas that validate requests
// (server/services/apiDocs) and cached for the life of the process.
export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  return buildOpenApiSpec()
})
