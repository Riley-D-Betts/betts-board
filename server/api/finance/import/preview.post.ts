import { financeImportPreviewSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { previewImport } from '../../../services/finance/import'
import { ImportParseError } from '../../../services/finance/parseFile'
import { requireHousehold } from '../../../utils/session'

// Dry run: parses the file, flags likely duplicates, and changes nothing.
export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const body = await readValidatedBody(event, financeImportPreviewSchema.parse)
  try {
    return previewImport(useDb(), { householdId: requireHousehold().id, ...body })
  }
  catch (error) {
    if (error instanceof ImportParseError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw error
  }
})
