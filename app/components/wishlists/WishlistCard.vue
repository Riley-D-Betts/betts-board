<!-- One wish list in the index grid. -->
<script setup lang="ts">
import type { WishlistDto } from '#shared/schemas/wishlists'

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
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days > 1) return `in ${days} days`
  if (days === -1) return 'yesterday'
  return `${Math.abs(days)} days ago`
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
        {{ list.itemCount }} {{ list.itemCount === 1 ? 'idea' : 'ideas' }}
      </UBadge>
      <UBadge v-if="countdown" variant="soft" :color="soon ? 'primary' : 'neutral'">
        <UIcon name="i-lucide-calendar-heart" class="size-3.5" />
        {{ countdown }}
      </UBadge>
    </div>
  </NuxtLink>
</template>
