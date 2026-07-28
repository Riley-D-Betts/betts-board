import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { LOCALE_DEFS, DEFAULT_LOCALE } from './shared/schemas/locales'

/**
 * Build identity, resolved once at build time.
 *
 * Without this there is no way to tell which build a running container is —
 * "did my rebuild actually take?" was previously unanswerable, which cost
 * several rounds of guessing. Surfaced by /api/health and Settings → About.
 *
 * The git SHA is read from the build context (the Docker build stage has .git),
 * falling back to $BETTS_COMMIT and then 'unknown' so a build from a tarball
 * still succeeds.
 */
function buildInfo() {
  const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
  let commit = process.env.BETTS_COMMIT ?? ''
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    }
    catch {
      commit = 'unknown'
    }
  }
  return { version, commit, builtAt: new Date().toISOString() }
}

export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',

  modules: ['@nuxt/ui', '@nuxt/eslint', '@vueuse/nuxt', 'nuxt-auth-utils', '@vite-pwa/nuxt', '@nuxtjs/i18n'],

  css: ['~/assets/css/main.css'],

  // Components register by bare filename (feature folders are organization,
  // not namespacing) — the whole codebase references them without prefixes.
  components: [{ path: '~/components', pathPrefix: false }],

  devtools: { enabled: false },

  // The language list comes from shared/schemas/locales.ts so it cannot drift
  // from the household setting's enum or the settings picker.
  //
  // - no_prefix: URLs must not move. The PWA start_url, the /tv routes, and
  //   the secret ICS feed URL are all already in the wild. It also means a
  //   bookmarked screen on the kitchen tablet keeps working when the family
  //   switches language.
  // - locale files are compiled into same-origin build chunks (matched by the
  //   PWA precache globs), so nothing is fetched from the internet and the
  //   board keeps working offline.
  // - no browser detection: the language is a household setting, read from the
  //   same bootstrap payload on the server and the client, so both sides agree
  //   from the first byte. Letting the browser vote would make a phone render
  //   one language and the wall tablet another — and would desynchronise SSR
  //   from hydration on the very first paint.
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: DEFAULT_LOCALE,
    locales: LOCALE_DEFS.map(l => ({ ...l })),
    detectBrowserLanguage: false,
    // Pluralisation rules — French counts zero as singular. See the file.
    vueI18n: './i18n.config.ts',
  },

  nitro: {
    preset: 'node-server',
    experimental: { tasks: true },
    scheduledTasks: {
      // In-process croner scheduling — fine for a single long-running container.
      '*/15 * * * *': ['ics:refresh'],
      '* * * * *': ['notify:dispatch'],
      // Hourly tick; each bank connection has its own interval (6h default)
      // and its own exponential backoff, so this only wakes what is due.
      '0 * * * *': ['finance:sync'],
    },
  },

  runtimeConfig: {
    // Overridable via BETTS_DATA_DIR (compose sets /data)
    dataDir: '.data',
    // Overridable via BETTS_TRUSTED_PROXY. Off by default: X-Forwarded-For is
    // client-writable, and rate limits keyed on it are trivially bypassed.
    // Set it to "1" ONLY when a reverse proxy you control is the only way in.
    trustedProxy: '',
    public: {
      // Baked at build time; the answer to "is this server running my change?"
      build: buildInfo(),
    },
    session: {
      // Long TTL: the kitchen wall tablet should stay unlocked for months.
      maxAge: 60 * 60 * 24 * 90,
      cookie: {
        // Browsers drop Secure cookies on plain-HTTP origins, which silently
        // breaks unlock on LAN deployments (http://host:3000). HTTPS setups
        // should set NUXT_SESSION_COOKIE_SECURE=true.
        secure: false,
      },
    },
  },

  app: {
    head: {
      title: 'Betts Board',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0f172a' },
        // iOS ignores the PWA manifest when adding to the home screen and reads
        // these instead — without them the "app" keeps Safari's toolbar. They
        // also work over plain HTTP, unlike manifest install.
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'Betts Board' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      ],
      link: [
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },

  pwa: {
    strategies: 'injectManifest',
    // Resolved against Nuxt's srcDir (app/), so step up to the repo root.
    srcDir: '../service-worker',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    manifest: {
      name: 'Betts Board',
      short_name: 'Betts Board',
      display: 'standalone',
      start_url: '/',
      background_color: '#0f172a',
      theme_color: '#0f172a',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    injectManifest: {
      // woff2 so a bundled household font still renders offline. Downloaded
      // Google fonts live in the data volume, outside the build, so they rely
      // on their immutable cache headers instead.
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
      // The Scalar docs bundle is ~3.7 MB and loads on demand behind auth —
      // keep it out of every phone's offline precache.
      globIgnores: ['**/docs-assets/**'],
    },
    devOptions: { enabled: false },
  },
})
