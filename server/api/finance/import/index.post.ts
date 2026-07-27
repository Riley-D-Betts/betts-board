import { financeImportCommitSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { commitImport } from '../../../services/finance/import'
import { ImportParseError } from '../../../services/finance/parseFile'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireFinanceAccess(event)
  const body = await readValidatedBody(event, financeImportCommitSchema.parse)
  try {
    return commitImport(useDb(), {
      householdId: requireHousehold().id,
      profileId: profile.id,
      ...body,
    })
  }
  catch (error) {
    if (error instanceof ImportParseError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw error
  }
})
