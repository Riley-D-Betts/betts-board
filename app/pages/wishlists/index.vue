<script setup lang="ts">
import type { WishlistDto } from '#shared/schemas/wishlists'

const { data: lists, refresh } = await useFetch<WishlistDto[]>('/api/wishlists', {
  default: () => [],
})

useLiveRefresh(refresh)

const editorOpen = ref(false)

// Dated lists first, soonest first; undated fall to the bottom.
const ordered = computed(() => {
  const today = todayString()
  return [...lists.value].sort((a, b) => {
    const ad = a.eventDate ? dateStringDiffDays(a.eventDate, today) : Number.MAX_SAFE_INTEGER
    const bd = b.eventDate ? dateStringDiffDays(b.eventDate, today) : Number.MAX_SAFE_INTEGER
    // Past events sink below upcoming ones.
    const aKey = ad < 0 ? Number.MAX_SAFE_INTEGER - 1 : ad
    const bKey = bd < 0 ? Number.MAX_SAFE_INTEGER - 1 : bd
    return aKey - bKey || a.title.localeCompare(b.title)
  })
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-2xl md:text-3xl font-bold flex-1">Wish lists</h1>
      <UButton icon="i-lucide-plus" @click="editorOpen = true">New list</UButton>
    </div>

    <div v-if="!ordered.length" class="py-16 text-center text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-gift" class="size-10 mb-2" />
      <p>No wish lists yet. Start one for a birthday or the holidays.</p>
      <UButton variant="soft" class="mt-3" icon="i-lucide-plus" @click="editorOpen = true">
        New list
      </UButton>
    </div>

    <div v-else class="grid gap-3 md:grid-cols-2">
      <WishlistCard v-for="list in ordered" :key="list.id" :list="list" />
    </div>

    <WishlistEditor v-model:open="editorOpen" @saved="refresh()" />
  </div>
</template>
