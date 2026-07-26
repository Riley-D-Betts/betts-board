import type { HouseholdSettings } from '#shared/schemas/household'

export interface BoardProfile {
  id: string
  name: string
  color: string
  avatarPath: string | null
  role: 'admin' | 'adult' | 'kid'
}

export interface BoardBootstrap {
  needsSetup: boolean
  householdName?: string
  needsPasswordReset?: boolean
  unlocked?: boolean
  activeProfileId?: string | null
  profiles?: BoardProfile[]
  /** Same shape the server stores — see #shared/schemas/household. */
  settings?: HouseholdSettings
  timezone?: string
  hasLocation?: boolean
}

/** App-stage state (setup? unlocked? acting profile?) shared everywhere.
 * Loaded once in route middleware, refreshed after auth transitions. */
export function useBoardState() {
  const state = useState<BoardBootstrap | null>('board-bootstrap', () => null)
  const requestFetch = useRequestFetch()

  async function refresh() {
    state.value = await requestFetch('/api/bootstrap')
  }

  async function ensureLoaded() {
    if (!state.value) await refresh()
  }

  const activeProfile = computed<BoardProfile | null>(() => {
    const s = state.value
    if (!s || s.needsSetup || !s.activeProfileId) return null
    return s.profiles?.find(p => p.id === s.activeProfileId) ?? null
  })

  const isAdmin = computed(() => activeProfile.value?.role === 'admin')

  async function switchProfile(profileId: string) {
    await $fetch('/api/auth/profile', { method: 'POST', body: { profileId } })
    await refresh()
  }

  async function lock() {
    await $fetch('/api/auth/lock', { method: 'POST' })
    await refresh()
    await navigateTo('/unlock')
  }

  return { state, refresh, ensureLoaded, activeProfile, isAdmin, switchProfile, lock }
}
