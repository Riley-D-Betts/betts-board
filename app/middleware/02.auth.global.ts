export default defineNuxtRouteMiddleware(async (to) => {
  const { state } = useBoardState()
  const s = state.value
  if (!s || s.needsSetup) return // setup middleware handles this stage

  if (!s.unlocked && to.path !== '/unlock') return navigateTo('/unlock')
  if (s.unlocked && to.path === '/unlock') return navigateTo('/')
})
