import { unlockSchema } from '#shared/schemas/auth'
import { unlockHousehold } from '../../services/auth/unlock'

export default defineEventHandler(async (event) => {
  const { password } = await readValidatedBody(event, unlockSchema.parse)
  // Rate limiting and the household lockout live in the service, so they can be
  // tested against the real attack rather than trusted to a route body.
  return await unlockHousehold(event, password)
})
