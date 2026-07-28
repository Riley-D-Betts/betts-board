<script setup lang="ts">
interface ListRow {
  id: string
  name: string
  isDefault: boolean
  uncheckedCount: number
}

const toast = useToast()
const { t } = useI18n()
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
    toast.add({ title: t('shopping.errors.couldNotCreateList'), color: 'error' })
  }
  finally {
    creating.value = false
  }
}

async function deleteList(list: ListRow) {
  const items = t('shopping.lists.uncheckedItems', list.uncheckedCount)
  if (!confirm(t('shopping.lists.confirmDelete', { name: list.name, items }))) return
  try {
    await $fetch(`/api/shopping-lists/${list.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch {
    toast.add({ title: t('shopping.errors.couldNotDeleteList'), color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl md:text-3xl font-bold">{{ $t('shopping.title') }}</h1>

    <form class="flex gap-2" @submit.prevent="createList">
      <UInput v-model="newName" :placeholder="$t('shopping.lists.newPlaceholder')" class="flex-1" />
      <UButton type="submit" icon="i-lucide-plus" :loading="creating" :disabled="!newName.trim()">
        {{ $t('common.actions.add') }}
      </UButton>
    </form>

    <div v-if="!lists.length" class="py-12 text-center text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-shopping-cart" class="mb-2 size-10" />
      <p>{{ $t('shopping.lists.empty') }}</p>
      <UButton to="/meals" variant="soft" class="mt-3" icon="i-lucide-utensils">
        {{ $t('shopping.lists.planMeals') }}
      </UButton>
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="list in lists"
        :key="list.id"
        class="flex min-h-14 items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pr-2 hover:border-primary/60"
      >
        <NuxtLink
          :to="`/shopping/${list.id}`"
          class="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-1"
        >
          <UIcon name="i-lucide-list" class="size-5 shrink-0 text-primary" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ list.name }}</span>
          <UBadge v-if="list.isDefault" variant="soft" size="sm">{{ $t('shopping.defaultBadge') }}</UBadge>
          <span class="text-sm text-slate-500 dark:text-slate-400">
            {{ $t('shopping.toBuy', { n: list.uncheckedCount }) }}
          </span>
          <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-slate-400" />
        </NuxtLink>
        <button
          class="flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
          :aria-label="$t('shopping.lists.deleteAria', { name: list.name })"
          @click="deleteList(list)"
        >
          <UIcon name="i-lucide-trash-2" class="size-4" />
        </button>
      </div>
    </div>
  </div>
</template>
