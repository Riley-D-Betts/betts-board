export default defineNuxtRouteMiddleware(async (to) => {
  const { state, ensureLoaded } = useBoardState()
  await ensureLoaded()

  if (state.value?.needsSetup && to.path !== '/setup') return navigateTo('/setup')
  if (!state.value?.needsSetup && to.path === '/setup') return navigateTo('/')
})
