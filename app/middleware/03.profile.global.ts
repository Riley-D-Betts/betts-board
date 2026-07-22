// TV routes are exempt: a wall display shows shared content and shouldn't
// require someone to "be" a profile.
const EXEMPT = ['/profiles', '/unlock', '/setup']

export default defineNuxtRouteMiddleware(async (to) => {
  const { state } = useBoardState()
  const s = state.value
  if (!s || s.needsSetup || !s.unlocked) return

  const exempt = EXEMPT.includes(to.path) || to.path.startsWith('/tv')
  if (!s.activeProfileId && !exempt) return navigateTo('/profiles')
})
