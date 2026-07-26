<!-- Phone-only full-screen menu: the complete map of the board, opened by the
     centre button in the tab bar.

     Built on UModal rather than another hand-rolled overlay so it gets a focus
     trap, Escape, scroll lock and focus restore — all of which the previous
     bottom sheet lacked, and all of which matter more once the surface covers
     the whole viewport. -->
<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })

const { menuGroups, isMenuActive } = useNavItems()
const { activeProfile, lock } = useBoardState()
const { build } = useRuntimeConfig().public
</script>

<template>
  <UModal
    v-model:open="open"
    fullscreen
    :title="$t('common.nav.allSections')"
    :transition="false"
    :ui="{
      // inset-0 puts the dialog under the notch, and the close button is
      // positioned against the content box rather than the header — so both
      // need the top inset applied separately.
      content: 'z-50 data-[state=open]:animate-[slide-in-from-bottom_200ms_ease-out] data-[state=closed]:animate-[slide-out-to-bottom_150ms_ease-in]',
      header: 'pt-[calc(1rem+env(safe-area-inset-top))]',
      close: 'top-[calc(1rem+env(safe-area-inset-top))]',
      footer: 'justify-center pb-[calc(1rem+env(safe-area-inset-bottom))]',
    }"
  >
    <template #body>
      <div class="space-y-6">
        <section v-for="group in menuGroups" :key="group.key">
          <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {{ group.label }}
          </h3>
          <div class="grid grid-cols-4 gap-2">
            <NuxtLink
              v-for="item in group.items"
              :key="item.to"
              :to="item.to"
              class="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-xs font-medium"
              :class="isMenuActive(item)
                ? 'bg-primary/10 text-primary'
                : 'text-slate-600 dark:text-slate-300 active:bg-slate-100 dark:active:bg-slate-800'"
            >
              <UIcon :name="item.icon" class="size-6 shrink-0" />
              <span class="leading-tight">{{ item.label }}</span>
            </NuxtLink>
          </div>
        </section>

        <!-- Who am I / lock -->
        <div class="flex items-center gap-2 border-t border-slate-200 dark:border-slate-800 pt-4">
          <NuxtLink
            to="/profiles"
            class="flex min-h-12 flex-1 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-700 dark:text-slate-200 active:bg-slate-100 dark:active:bg-slate-800"
          >
            <ProfileAvatar v-if="activeProfile" :profile="activeProfile" size="sm" />
            <UIcon v-else name="i-lucide-user" class="size-6" />
            <span class="truncate">{{ activeProfile?.name ?? $t('common.nav.chooseProfile') }}</span>
            <UIcon name="i-lucide-chevron-right" class="ml-auto size-4 shrink-0 text-slate-400" />
          </NuxtLink>
          <button
            class="flex min-h-12 items-center gap-2 rounded-xl px-4 text-sm font-medium text-slate-500 active:bg-slate-100 dark:active:bg-slate-800"
            @click="lock()"
          >
            <UIcon name="i-lucide-lock" class="size-5" />
            {{ $t('common.nav.lock') }}
          </button>
        </div>

        <!-- Which build is this? One tap from anywhere on the phone. -->
        <p class="pt-2 text-center text-xs text-slate-400 dark:text-slate-500">
          v{{ build.version }} · {{ build.commit }}
        </p>
      </div>
    </template>

    <template #footer>
      <!-- Mirrors the tab bar's centre button, so "tap the middle again to
           close" is true even though the bar itself is covered. -->
      <UButton
        icon="i-lucide-x"
        color="primary"
        size="xl"
        class="size-14 justify-center rounded-full shadow-lg"
        :aria-label="$t('common.nav.closeMenu')"
        @click="open = false"
      />
    </template>
  </UModal>
</template>
