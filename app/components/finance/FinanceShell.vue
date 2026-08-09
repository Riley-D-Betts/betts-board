<!-- Wraps every /finance page: renders the lock screen until there's a live
     finance session, and the section header once there is. -->
<script setup lang="ts">
defineProps<{ title?: string }>()

const { state, unlocked, lock, ensureLoaded, useAutoLock } = useFinanceSession()
const { t } = useI18n()
const toast = useToast()
const route = useRoute()

await ensureLoaded()
useAutoLock()

const tabs = computed(() => [
  { to: '/finance', label: t('finance.nav.overview'), icon: 'i-lucide-wallet', exact: true },
  { to: '/finance/transactions', label: t('finance.nav.transactions'), icon: 'i-lucide-receipt' },
  { to: '/finance/budgets', label: t('finance.nav.budgets'), icon: 'i-lucide-chart-pie' },
  { to: '/finance/bills', label: t('finance.nav.bills'), icon: 'i-lucide-calendar-clock' },
  { to: '/finance/goals', label: t('finance.nav.goals'), icon: 'i-lucide-target' },
  { to: '/finance/debts', label: t('finance.nav.debts'), icon: 'i-lucide-trending-down' },
  { to: '/finance/settings', label: t('finance.nav.settings'), icon: 'i-lucide-settings' },
])

function isActive(tab: { to: string, exact?: boolean }) {
  return tab.exact ? route.path === tab.to : route.path.startsWith(tab.to)
}

// Counts down in the last two minutes so the lock isn't a surprise mid-typing.
const now = useNow({ interval: 1000 })
const secondsLeft = computed(() => {
  const expiresAt = state.value?.expiresAt
  if (!expiresAt) return null
  return Math.max(0, Math.round((expiresAt - now.value.getTime()) / 1000))
})
const countdown = computed(() => {
  const s = secondsLeft.value
  if (s == null || s > 120) return null
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

async function lockNow() {
  await lock()
  toast.add({ title: t('finance.toast.locked'), icon: 'i-lucide-lock', color: 'neutral' })
}
</script>

<template>
  <div>
    <FinanceLockScreen v-if="!unlocked" />

    <div v-else class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-bold">{{ title ?? $t('finance.title') }}</h1>
        <div class="flex items-center gap-2">
          <UBadge v-if="countdown" color="warning" variant="subtle" size="sm">
            {{ $t('finance.lock.expiresIn', { time: countdown }) }}
          </UBadge>
          <UButton
            icon="i-lucide-lock"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="lockNow"
          >
            {{ $t('finance.lock.lockNow') }}
          </UButton>
        </div>
      </div>

      <nav class="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div class="flex w-max gap-1 sm:w-auto">
          <NuxtLink
            v-for="tab in tabs"
            :key="tab.to"
            :to="tab.to"
            class="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors"
            :class="isActive(tab)
              ? 'bg-primary/10 text-primary'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'"
          >
            <UIcon :name="tab.icon" class="size-4" />
            {{ tab.label }}
          </NuxtLink>
        </div>
      </nav>

      <slot />
    </div>
  </div>
</template>
