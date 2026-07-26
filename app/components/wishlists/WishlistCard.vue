<!-- One wish list in the index grid. -->
<script setup lang="ts">
import type { WishlistDto } from '#shared/schemas/wishlists'

const { t } = useI18n()

const props = defineProps<{ list: WishlistDto }>()

const today = todayString()

// dateStringDiffDays(a, b) is a − b, so put the event first to get
// "days from now" rather than "days ago".
const daysAway = computed(() =>
  props.list.eventDate ? dateStringDiffDays(props.list.eventDate, today) : null)

/** "in 12 days" / "today" / "3 days ago" — the point of putting a date on a list. */
const countdown = computed(() => {
  const days = daysAway.value
  if (days === null) return null
  if (days === 0) return t('common.actions.today').toLowerCase()
  if (days === 1) return t('common.actions.tomorrow').toLowerCase()
  if (days > 1) return t('wishlists.countdown.inDays', { n: days }).toLowerCase()
  if (days === -1) return t('common.actions.yesterday').toLowerCase()
  return t('wishlists.countdown.daysAgo', { n: Math.abs(days) })
})

const soon = computed(() => daysAway.value !== null && daysAway.value >= 0 && daysAway.value <= 30)
</script>

<template>
  <NuxtLink
    :to="`/wishlists/${list.id}`"
    class="block rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 transition-colors hover:border-primary"
  >
    <div class="flex items-center gap-3">
      <ProfileAvatar :profile="{ name: list.profileName, color: list.profileColor }" size="sm" />
      <div class="min-w-0 flex-1">
        <p class="font-semibold truncate">{{ list.title }}</p>
        <p class="text-sm text-slate-500 dark:text-slate-400 truncate">
          {{ list.profileName }}<template v-if="list.occasion"> · {{ list.occasion }}</template>
        </p>
      </div>
      <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-slate-400" />
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <UBadge variant="soft" color="neutral">
        {{ $t('wishlists.ideas', list.itemCount) }}
      </UBadge>
      <UBadge v-if="countdown" variant="soft" :color="soon ? 'primary' : 'neutral'">
        <UIcon name="i-lucide-calendar-heart" class="size-3.5" />
        {{ countdown }}
      </UBadge>
    </div>
  </NuxtLink>
</template>
