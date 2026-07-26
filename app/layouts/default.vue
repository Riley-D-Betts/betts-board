<script setup lang="ts">
const { activeProfile, lock } = useBoardState()
const route = useRoute()
const { tabs, sidebarItems, isTabActive } = useNavItems()

// Phone-only full-screen menu. The tab bar holds four destinations; the raised
// centre button opens the complete map of the board.
const menuOpen = ref(false)
watch(() => route.path, () => {
  menuOpen.value = false
})

// Resizing to desktop with the menu open would strand a focus-trapped dialog
// over the sidebar UI. Closing it in JS rather than hiding it with md:hidden —
// display:none on trapped content leaves focus somewhere invisible.
const isDesktop = useMediaQuery('(min-width: 768px)')
watch(isDesktop, (desktop) => {
  if (desktop) menuOpen.value = false
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
        v-for="item in sidebarItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        :class="isTabActive(item)
          ? 'bg-primary/10 text-primary'
          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'"
      >
        <UIcon :name="item.icon" class="size-5" />
        {{ item.label }}
      </NuxtLink>
      <div class="mt-auto">
        <NuxtLink to="/profiles" class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
          <ProfileAvatar v-if="activeProfile" :profile="activeProfile" size="sm" />
          <span class="text-sm font-medium truncate">{{ activeProfile?.name ?? $t('common.nav.chooseProfile') }}</span>
        </NuxtLink>
        <button
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          @click="lock()"
        >
          <UIcon name="i-lucide-lock" class="size-4" />
          {{ $t('common.nav.lock') }}
        </button>
      </div>
    </aside>

    <!-- Main content. Bottom padding clears the bar *and* the raised centre
         button, plus the home indicator on gesture-nav phones. -->
    <main class="md:pl-56 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-6">
      <div class="mx-auto max-w-6xl px-4 pt-4 md:px-8 md:pt-8">
        <slot />
      </div>
    </main>

    <!-- Bottom tab bar (phone): 4 tabs around a raised centre button -->
    <nav class="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div class="grid grid-cols-5">
        <NuxtLink
          v-for="item in tabs.slice(0, 2)"
          :key="item.to"
          :to="item.to"
          class="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium"
          :class="isTabActive(item) ? 'text-primary' : 'text-slate-500'"
        >
          <UIcon :name="item.icon" class="size-6" />
          {{ item.label }}
        </NuxtLink>

        <!-- Centre: opens the full-screen menu. A grid icon, not a house —
             Home is a tab of its own, and the same glyph doing two different
             things reads as broken. -->
        <button
          class="relative flex min-h-14 flex-col items-center justify-end pb-1 text-[10px] font-medium text-slate-500"
          :aria-label="$t('common.nav.openMenu')"
          aria-haspopup="dialog"
          :aria-expanded="menuOpen"
          @click="menuOpen = true"
        >
          <span class="absolute -top-5 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-lg active:scale-95 transition-transform">
            <UIcon name="i-lucide-layout-grid" class="size-7" />
          </span>
          {{ $t('common.nav.all') }}
        </button>

        <NuxtLink
          v-for="item in tabs.slice(2)"
          :key="item.to"
          :to="item.to"
          class="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium"
          :class="isTabActive(item) ? 'text-primary' : 'text-slate-500'"
        >
          <UIcon :name="item.icon" class="size-6" />
          {{ item.label }}
        </NuxtLink>
      </div>
    </nav>

    <NavMenuSheet v-model:open="menuOpen" />
  </div>
</template>
