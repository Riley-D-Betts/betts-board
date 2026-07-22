export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',

  modules: ['@nuxt/ui', '@nuxt/eslint', '@vueuse/nuxt', 'nuxt-auth-utils', '@vite-pwa/nuxt'],

  css: ['~/assets/css/main.css'],

  // Components register by bare filename (feature folders are organization,
  // not namespacing) — the whole codebase references them without prefixes.
  components: [{ path: '~/components', pathPrefix: false }],

  devtools: { enabled: false },

  nitro: {
    preset: 'node-server',
    experimental: { tasks: true },
    scheduledTasks: {
      // In-process croner scheduling — fine for a single long-running container.
      '*/15 * * * *': ['ics:refresh'],
      '* * * * *': ['notify:dispatch'],
    },
  },

  runtimeConfig: {
    // Overridable via BETTS_DATA_DIR (compose sets /data)
    dataDir: '.data',
    session: {
      // Long TTL: the kitchen wall tablet should stay unlocked for months.
      maxAge: 60 * 60 * 24 * 90,
    },
  },

  app: {
    head: {
      title: 'Betts Board',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0f172a' },
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
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
    },
    devOptions: { enabled: false },
  },
})
