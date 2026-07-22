import { generateFromMealPlanSchema } from '#shared/schemas/shopping'
import { useDb } from '../../db/client'
import { generateFromMealPlan } from '../../services/shopping/aggregate'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const input = await readValidatedBody(event, generateFromMealPlanSchema.parse)
  const hh = requireHousehold()

  return generateFromMealPlan(useDb(), {
    householdId: hh.id,
    start: input.start,
    end: input.end,
    listId: input.listId,
    ignorePantry: input.ignorePantry,
    createdByProfileId: profile.id,
  })
})
