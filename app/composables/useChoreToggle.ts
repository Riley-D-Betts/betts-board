import type { ChoreInstance } from '#shared/schemas/chores'

interface CompleteResponse {
  pointsAwarded?: number
  streak?: number
}

/**
 * The one place a chore gets checked off. The dashboard tile and the chores
 * page had near-identical copies of this — with different toast wording — so
 * any change had to be made twice and the celebration would have been a third.
 */
export function useChoreToggle(refresh: () => unknown) {
  const toast = useToast()
  const { celebrate } = useCelebration()

  async function toggle(instance: ChoreInstance) {
    const url = `/api/chores/${instance.choreId}/complete`
    const body = { dueDate: instance.dueDate, profileId: instance.profileId }
    try {
      if (instance.completed) {
        await $fetch(url, { method: 'DELETE', body })
      }
      else {
        const result = await $fetch<CompleteResponse>(url, { method: 'POST', body })
        celebrate({
          title: instance.title,
          emoji: instance.emoji ?? null,
          profileName: instance.profileName,
          points: result?.pointsAwarded ?? instance.points,
          streak: result?.streak ?? 0,
        })
      }
      await refresh()
      // Other open views (dashboard tiles, another tab) update immediately.
      bumpDataTick()
    }
    catch {
      toast.add({ title: 'Could not update chore', color: 'error' })
    }
  }

  return { toggle }
}
