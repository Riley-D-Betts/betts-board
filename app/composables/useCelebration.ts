export interface CelebrationEvent {
  title: string
  emoji: string | null
  profileName: string
  points: number
  /** Consecutive days this chore has been done by this person. */
  streak: number
}

/**
 * Queue for the chore-completion celebration. The trigger (useChoreToggle) and
 * the renderer (CelebrationLayer, mounted once in app.vue) are decoupled so
 * check-offs celebrate identically from the dashboard tile and the chores page.
 */
export function useCelebration() {
  const current = useState<CelebrationEvent | null>('celebration', () => null)
  const lastAt = useState<number>('celebration-at', () => 0)

  function celebrate(event: CelebrationEvent) {
    // Nothing to celebrate: no points and no streak worth naming.
    if (event.points <= 0 && event.streak < 2) return
    // Checking off six chores in a row shouldn't strobe.
    const now = Date.now()
    if (now - lastAt.value < 1200) return
    lastAt.value = now
    current.value = event
  }

  function dismiss() {
    current.value = null
  }

  return { current, celebrate, dismiss }
}
