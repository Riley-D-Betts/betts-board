<script setup lang="ts">
import type { WishlistDto, WishlistItemDto } from '#shared/schemas/wishlists'

const route = useRoute()
const toast = useToast()
const { activeProfile } = useBoardState()
const listId = route.params.id as string

const { data: list, refresh } = await useFetch<WishlistDto>(`/api/wishlists/${listId}`)

if (!list.value) {
  throw createError({ statusCode: 404, statusMessage: 'Wish list not found', fatal: true })
}

useLiveRefresh(refresh)

// Anyone but a kid looking at someone else's list can add ideas.
const canEdit = computed(() => {
  const p = activeProfile.value
  if (!p) return false
  return p.role !== 'kid' || list.value?.profileId === p.id
})

const PRIORITY = [
  { label: 'Nice to have', value: 0 },
  { label: 'Would love', value: 1 },
  { label: 'Really wants', value: 2 },
]

const draft = reactive({ name: '', url: '', price: '', notes: '', priority: 0 })
const adding = ref(false)
const editing = ref<WishlistItemDto | null>(null)
const editorOpen = ref(false)

async function addItem() {
  if (!draft.name.trim()) return
  adding.value = true
  try {
    await $fetch(`/api/wishlists/${listId}/items`, {
      method: 'POST',
      body: {
        name: draft.name.trim(),
        url: draft.url.trim() || null,
        price: draft.price.trim() || null,
        notes: draft.notes.trim() || null,
        priority: draft.priority,
      },
    })
    Object.assign(draft, { name: '', url: '', price: '', notes: '', priority: 0 })
    await refresh()
  }
  catch (err) {
    const e = err as { data?: { statusMessage?: string } }
    toast.add({ title: e.data?.statusMessage ?? 'Could not add that', color: 'error' })
  }
  finally {
    adding.value = false
  }
}

async function removeItem(item: WishlistItemDto) {
  if (!confirm(`Remove "${item.name}" from this list?`)) return
  try {
    await $fetch(`/api/wishlists/${listId}/items/${item.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch {
    toast.add({ title: 'Could not remove that', color: 'error' })
  }
}

async function archiveList() {
  if (!confirm('Archive this wish list?')) return
  try {
    await $fetch(`/api/wishlists/${listId}`, { method: 'DELETE' })
    await navigateTo('/wishlists')
  }
  catch {
    toast.add({ title: 'Could not archive the list', color: 'error' })
  }
}

// Most-wanted first.
const items = computed(() => [...(list.value?.items ?? [])]
  .sort((a, b) => b.priority - a.priority || a.sortOrder - b.sortOrder))

const today = todayString()
const countdown = computed(() => {
  if (!list.value?.eventDate) return null
  const days = dateStringDiffDays(list.value.eventDate, today)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return days > 0 ? `In ${days} days` : `${Math.abs(days)} days ago`
})
</script>

<template>
  <div v-if="list" class="space-y-6 max-w-3xl">
    <div class="flex flex-wrap items-start gap-2">
      <UButton to="/wishlists" icon="i-lucide-arrow-left" variant="ghost" color="neutral" aria-label="Back to wish lists" />
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl md:text-3xl font-bold truncate">{{ list.title }}</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {{ list.profileName }}<template v-if="list.occasion"> · {{ list.occasion }}</template>
          <template v-if="countdown"> · {{ countdown }}</template>
        </p>
      </div>
      <UButton
        v-if="canEdit"
        icon="i-lucide-pencil"
        variant="soft"
        color="neutral"
        @click="editing = null; editorOpen = true"
      >
        Edit
      </UButton>
    </div>

    <!-- Add an idea -->
    <UCard v-if="canEdit">
      <div class="space-y-3">
        <UFormField label="Add an idea">
          <UInput
            v-model="draft.name"
            placeholder="Lego Botanical set"
            class="w-full"
            size="lg"
            @keydown.enter.prevent="addItem"
          />
        </UFormField>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Link" hint="optional">
            <UInput v-model="draft.url" placeholder="https://…" class="w-full" />
          </UFormField>
          <UFormField label="Rough price" hint="optional">
            <UInput v-model="draft.price" placeholder="about $30" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Notes" hint="optional">
          <UTextarea v-model="draft.notes" :rows="2" class="w-full" placeholder="Size medium, blue if they have it" />
        </UFormField>
        <UFormField label="How much do they want it">
          <USelect v-model="draft.priority" :items="PRIORITY" class="w-full" />
        </UFormField>
        <UButton icon="i-lucide-plus" :loading="adding" :disabled="!draft.name.trim()" @click="addItem">
          Add to list
        </UButton>
      </div>
    </UCard>

    <div v-if="!items.length" class="py-12 text-center text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-gift" class="size-10 mb-2" />
      <p>Nothing on this list yet.</p>
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="item in items"
        :key="item.id"
        class="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3"
      >
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <a
              v-if="item.url"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium text-primary hover:underline truncate"
            >{{ item.name }}</a>
            <span v-else class="font-medium truncate">{{ item.name }}</span>
            <UBadge v-if="item.priority === 2" variant="soft" color="primary">Really wants</UBadge>
            <UBadge v-else-if="item.priority === 1" variant="soft" color="neutral">Would love</UBadge>
          </div>
          <p v-if="item.price" class="text-sm font-semibold text-slate-600 dark:text-slate-300">{{ item.price }}</p>
          <p v-if="item.notes" class="text-sm text-slate-500 dark:text-slate-400">{{ item.notes }}</p>
        </div>
        <UButton
          v-if="canEdit"
          icon="i-lucide-trash-2"
          variant="ghost"
          color="error"
          :aria-label="`Remove ${item.name}`"
          @click="removeItem(item)"
        />
      </div>
    </div>

    <UButton v-if="canEdit" variant="ghost" color="error" icon="i-lucide-archive" @click="archiveList">
      Archive this list
    </UButton>

    <WishlistEditor v-model:open="editorOpen" :list="list" @saved="refresh()" />
  </div>
</template>
