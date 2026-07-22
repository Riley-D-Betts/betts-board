<script setup lang="ts">
const { activeProfile, lock } = useBoardState()
const route = useRoute()

const nav = [
  { to: '/', label: 'Home', icon: 'i-lucide-house' },
  { to: '/calendar', label: 'Calendar', icon: 'i-lucide-calendar-days' },
  { to: '/chores', label: 'Chores', icon: 'i-lucide-list-checks' },
  { to: '/meals', label: 'Meals', icon: 'i-lucide-utensils' },
  { to: '/shopping', label: 'Shopping', icon: 'i-lucide-shopping-cart' },
]

const moreNav = [
  { to: '/recipes', label: 'Recipes', icon: 'i-lucide-chef-hat' },
  { to: '/pantry', label: 'Pantry', icon: 'i-lucide-package' },
  { to: '/photos', label: 'Photos', icon: 'i-lucide-image' },
  { to: '/tv', label: 'TV mode', icon: 'i-lucide-tv' },
  { to: '/settings', label: 'Settings', icon: 'i-lucide-settings' },
]

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <div class="min-h-dvh bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
    <!-- Sidebar (tablet/desktop) -->
    <aside class="hidden md:flex fixed inset-y-0 left-0 w-56 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 gap-1 z-30">
      <NuxtLink to="/" class="flex items-center gap-2 px-3 py-3 font-bold text-lg">
        <UIcon name="i-lucide-layout-dashboard" class="text-primary size-6" />
        Betts Board
      </NuxtLink>
      <NuxtLink
        v-for="item in [...nav, ...moreNav]"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        :class="isActive(item.to)
          ? 'bg-primary/10 text-primary'
          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'"
      >
        <UIcon :name="item.icon" class="size-5" />
        {{ item.label }}
      </NuxtLink>
      <div class="mt-auto">
        <NuxtLink to="/profiles" class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
          <ProfileAvatar v-if="activeProfile" :profile="activeProfile" size="sm" />
          <span class="text-sm font-medium truncate">{{ activeProfile?.name ?? 'Choose profile' }}</span>
        </NuxtLink>
        <button
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          @click="lock()"
        >
          <UIcon name="i-lucide-lock" class="size-4" />
          Lock
        </button>
      </div>
    </aside>

    <!-- Main content -->
    <main class="md:pl-56 pb-20 md:pb-6">
      <div class="mx-auto max-w-6xl px-4 pt-4 md:px-8 md:pt-8">
        <slot />
      </div>
    </main>

    <!-- Bottom tab bar (phone) -->
    <nav class="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div class="grid grid-cols-6">
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium"
          :class="isActive(item.to) ? 'text-primary' : 'text-slate-500'"
        >
          <UIcon :name="item.icon" class="size-6" />
          {{ item.label }}
        </NuxtLink>
        <NuxtLink
          to="/settings"
          class="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium"
          :class="route.path.startsWith('/settings') || route.path.startsWith('/recipes') || route.path.startsWith('/pantry') || route.path.startsWith('/photos') ? 'text-primary' : 'text-slate-500'"
        >
          <UIcon name="i-lucide-menu" class="size-6" />
          More
        </NuxtLink>
      </div>
    </nav>
  </div>
</template>
