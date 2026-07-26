<!-- Dashboard tile: default shopping list peek with inline check-off. -->
<script setup lang="ts">
interface QuickItem {
  id: string
  name: string
  displayQuantity: string | null
  checked: boolean
}
interface ListDetail {
  id: string
  name: string
  items: QuickItem[]
}

const toast = useToast()
const requestFetch = useRequestFetch()

const { data: list, refresh } = await useAsyncData('shopping-quick-tile', async () => {
  const lists = await requestFetch<{ id: string, isDefault: boolean }[]>('/api/shopping-lists')
  const target = lists.find(l => l.isDefault) ?? lists[0]
  if (!target) return null
  return await requestFetch<ListDetail>(`/api/shopping-lists/${target.id}`)
})

useLiveRefresh(refresh)

const unchecked = computed(() => (list.value?.items ?? []).filter(i => !i.checked))

async function check(item: QuickItem) {
  if (!list.value) return
  try {
    await $fetch(`/api/shopping-lists/${list.value.id}/items/${item.id}`, {
      method: 'PATCH',
      body: { checked: true },
    })
    await refresh()
  }
  catch {
    toast.add({ title: 'Could not check off the item', color: 'error' })
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <NuxtLink
        :to="list ? `/shopping/${list.id}` : '/shopping'"
        class="flex items-center gap-2 font-semibold hover:text-primary"
      >
        <UIcon name="i-lucide-shopping-cart" class="text-primary size-5" />
        <span class="flex-1">Shopping</span>
        <span v-if="unchecked.length" class="text-xs font-normal text-slate-500 dark:text-slate-400">
          {{ unchecked.length }} to buy
        </span>
        <UIcon name="i-lucide-chevron-right" class="size-4 text-slate-400" />
      </NuxtLink>
    </template>

    <p v-if="!list || !unchecked.length" class="text-sm text-slate-500 dark:text-slate-400">
      Nothing on the list — nice.
    </p>
    <div v-else class="-my-1 divide-y divide-slate-100 dark:divide-slate-800">
      <ShoppingItemRow
        v-for="item in unchecked.slice(0, 5)"
        :key="item.id"
        :item="item"
        compact
        class="px-0"
        @toggle="check(item)"
      />
      <p v-if="unchecked.length > 5" class="py-1.5 text-xs text-slate-500 dark:text-slate-400">
        +{{ unchecked.length - 5 }} more on the list
      </p>
    </div>
  </UCard>
</template>
