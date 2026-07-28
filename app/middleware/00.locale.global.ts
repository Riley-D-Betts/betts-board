import { DEFAULT_LOCALE, LOCALE_CODES } from '#shared/schemas/locales'

/**
 * Applies the household's language before anything renders.
 *
 * Runs first (00) and on BOTH sides: during SSR the bootstrap payload is
 * fetched with the incoming request's cookies, and on the client it comes from
 * the same `useState` — so the server and the browser pick the same language
 * from the same value and hydration matches. Deciding the language any later,
 * or from anything device-local, produces a first paint in one language that
 * flips to another.
 *
 * `ensureLoaded` is memoised in useBoardState, so this costs no extra request.
 *
 * ⚠️ Reaches the i18n instance through `useNuxtApp().$i18n`, NOT `useI18n()`.
 * Route middleware is not a component setup scope, and `useI18n()` there throws
 * vue-i18n error 26 (MUST_BE_CALL_SETUP_TOP) — which during SSR is a 500 on
 * every single page, with a message of just "26". It does not fail at build
 * time and no unit test renders a route, so only loading a page in the
 * production server finds it.
 */
export default defineNuxtRouteMiddleware(async () => {
  const { state, ensureLoaded } = useBoardState()
  await ensureLoaded()

  const i18n = useNuxtApp().$i18n
  const wanted = state.value?.settings?.locale ?? DEFAULT_LOCALE
  // Guarding on the known list matters: a settings row written by a newer
  // build (or by hand) could name a language this build doesn't ship, and
  // setLocale on an unknown code leaves every string as its raw key.
  const next = LOCALE_CODES.includes(wanted) ? wanted : DEFAULT_LOCALE
  if (unref(i18n.locale) !== next) await i18n.setLocale(next as 'en')
})
