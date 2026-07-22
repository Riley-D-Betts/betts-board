import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { shoppingListItems, shoppingLists } from '../../db/schema'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const hh = requireHousehold()

  const lists = useDb().select().from(shoppingLists)
    .where(eq(shoppingLists.householdId, hh.id))
    .orderBy(desc(shoppingLists.isDefault), asc(shoppingLists.createdAt))
    .all()
  if (!lists.length) return []

  const counts = useDb().select({
    listId: shoppingListItems.listId,
    n: sql<number>`count(*)`,
  }).from(shoppingListItems).where(and(
    inArray(shoppingListItems.listId, lists.map(l => l.id)),
    eq(shoppingListItems.checked, false),
  )).groupBy(shoppingListItems.listId).all()
  const countByList = new Map(counts.map(c => [c.listId, c.n]))

  return lists.map(l => ({ ...l, uncheckedCount: countByList.get(l.id) ?? 0 }))
})
