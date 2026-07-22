export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',

  modules: ['@nuxt/ui', '@nuxt/eslint', '@vueuse/nuxt', 'nuxt-auth-utils'],

  css: ['~/assets/css/main.css'],

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
})
