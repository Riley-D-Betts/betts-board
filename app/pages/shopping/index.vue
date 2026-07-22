<script setup lang="ts">
interface ListRow {
  id: string
  name: string
  isDefault: boolean
  uncheckedCount: number
}

const toast = useToast()
const { data: lists, refresh } = await useFetch<ListRow[]>('/api/shopping-lists', {
  default: () => [],
})

const newName = ref('')
const creating = ref(false)

async function createList() {
  const name = newName.value.trim()
  if (!name) return
  creating.value = true
  try {
    await $fetch('/api/shopping-lists', { method: 'POST', body: { name } })
    newName.value = ''
    await refresh()
  }
  catch {
    toast.add({ title: 'Could not create the list', color: 'error' })
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl md:text-3xl font-bold">Shopping</h1>

    <form class="flex gap-2" @submit.prevent="createList">
      <UInput v-model="newName" placeholder="New list — “Costco run”…" class="flex-1" />
      <UButton type="submit" icon="i-lucide-plus" :loading="creating" :disabled="!newName.trim()">
        Add
      </UButton>
    </form>

    <div v-if="!lists.length" class="py-12 text-center text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-shopping-cart" class="mb-2 size-10" />
      <p>No lists yet — create one above, or plan meals and generate one.</p>
      <UButton to="/meals" variant="soft" class="mt-3" icon="i-lucide-utensils">
        Plan meals
      </UButton>
    </div>

    <div v-else class="space-y-2">
      <NuxtLink
        v-for="list in lists"
        :key="list.id"
        :to="`/shopping/${list.id}`"
        class="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 hover:border-primary/60"
      >
        <UIcon name="i-lucide-list" class="size-5 shrink-0 text-primary" />
        <span class="min-w-0 flex-1 truncate font-medium">{{ list.name }}</span>
        <UBadge v-if="list.isDefault" variant="soft" size="sm">default</UBadge>
        <span class="text-sm text-slate-500 dark:text-slate-400">
          {{ list.uncheckedCount }} to buy
        </span>
        <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-slate-400" />
      </NuxtLink>
    </div>
  </div>
</template>
