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
  { to: '/rewards', label: 'Rewards', icon: 'i-lucide-gift' },
  { to: '/pantry', label: 'Pantry', icon: 'i-lucide-package' },
  { to: '/photos', label: 'Photos', icon: 'i-lucide-image' },
  { to: '/tv', label: 'TV mode', icon: 'i-lucide-tv' },
  { to: '/feedback', label: 'Feedback', icon: 'i-lucide-megaphone' },
  { to: '/settings', label: 'Settings', icon: 'i-lucide-settings' },
]

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}

// Phone-only "More" bottom sheet: the tab bar fits 5 destinations, everything
// else lives in here. Closes itself after navigation.
const moreOpen = ref(false)
const moreActive = computed(() => moreNav.some(item => route.path.startsWith(item.to)))
watch(() => route.path, () => {
  moreOpen.value = false
})
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
        <button
          class="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium"
          :class="moreActive || moreOpen ? 'text-primary' : 'text-slate-500'"
          @click="moreOpen = !moreOpen"
        >
          <UIcon name="i-lucide-menu" class="size-6" />
          More
        </button>
      </div>
    </nav>

    <!-- "More" bottom sheet (phone) -->
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="moreOpen"
        class="md:hidden fixed inset-0 z-40 bg-black/40"
        @click="moreOpen = false"
      />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-200 ease-out"
      leave-active-class="transition-transform duration-150 ease-in"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
    >
      <div
        v-if="moreOpen"
        class="md:hidden fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <div class="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        <div class="grid grid-cols-4 gap-2">
          <NuxtLink
            v-for="item in moreNav"
            :key="item.to"
            :to="item.to"
            class="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl py-2 text-xs font-medium"
            :class="isActive(item.to)
              ? 'bg-primary/10 text-primary'
              : 'text-slate-600 dark:text-slate-300 active:bg-slate-100 dark:active:bg-slate-800'"
          >
            <UIcon :name="item.icon" class="size-6" />
            {{ item.label }}
          </NuxtLink>
        </div>

        <!-- Who am I / lock. Both used to exist only in the desktop sidebar,
             so on a phone there was no way to switch profile or lock at all. -->
        <div class="mt-3 flex items-center gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
          <NuxtLink
            to="/profiles"
            class="flex min-h-12 flex-1 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-700 dark:text-slate-200 active:bg-slate-100 dark:active:bg-slate-800"
          >
            <ProfileAvatar v-if="activeProfile" :profile="activeProfile" size="sm" />
            <UIcon v-else name="i-lucide-user" class="size-6" />
            <span class="truncate">{{ activeProfile?.name ?? 'Choose profile' }}</span>
            <UIcon name="i-lucide-chevron-right" class="ml-auto size-4 shrink-0 text-slate-400" />
          </NuxtLink>
          <button
            class="flex min-h-12 items-center gap-2 rounded-xl px-4 text-sm font-medium text-slate-500 active:bg-slate-100 dark:active:bg-slate-800"
            @click="lock()"
          >
            <UIcon name="i-lucide-lock" class="size-5" />
            Lock
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
