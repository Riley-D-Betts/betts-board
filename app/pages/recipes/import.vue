<script setup lang="ts">
const toast = useToast()

const url = ref('')
const importing = ref(false)
const errorMessage = ref<string | null>(null)

const looksLikeUrl = computed(() => /^https?:\/\/\S+\.\S+/.test(url.value.trim()))

async function importRecipe() {
  const target = url.value.trim()
  if (!target || importing.value) return
  importing.value = true
  errorMessage.value = null
  try {
    const recipe = await $fetch('/api/recipes/import', { method: 'POST', body: { url: target } })
    toast.add({ title: 'Recipe imported', description: recipe.title, icon: 'i-lucide-chef-hat', color: 'success' })
    await navigateTo(`/recipes/${recipe.id}/edit`)
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string }
    errorMessage.value = e.data?.statusMessage ?? e.statusMessage
      ?? 'Something went wrong importing that recipe.'
    importing.value = false
  }
}

const creating = ref(false)

async function enterManually() {
  if (creating.value) return
  creating.value = true
  try {
    const recipe = await $fetch('/api/recipes', { method: 'POST', body: { title: 'New recipe' } })
    await navigateTo(`/recipes/${recipe.id}/edit`)
  }
  catch {
    toast.add({ title: 'Could not create recipe', color: 'error' })
    creating.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-xl">
    <div class="flex items-center gap-2">
      <UButton to="/recipes" icon="i-lucide-arrow-left" variant="ghost" color="neutral" aria-label="Back to recipes" />
      <h1 class="text-2xl md:text-3xl font-bold">Import a recipe</h1>
    </div>

    <UCard>
      <div class="space-y-4">
        <p class="text-sm text-slate-500 dark:text-slate-400">
          Paste a link to any recipe page and we'll pull in the title, ingredients, steps, and photo.
        </p>

        <UFormField label="Recipe link">
          <UInput
            v-model="url"
            type="url"
            placeholder="https://example.com/best-lasagna"
            icon="i-lucide-link"
            size="lg"
            class="w-full"
            :disabled="importing"
            @keydown.enter="importRecipe"
          />
        </UFormField>

        <div v-if="importing" class="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          Fetching recipe…
        </div>

        <div
          v-else-if="errorMessage"
          class="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300 space-y-2"
        >
          <p>{{ errorMessage }}</p>
          <UButton variant="link" color="error" size="sm" class="px-0" :loading="creating" @click="enterManually">
            Enter it manually instead
          </UButton>
        </div>

        <UButton
          block
          size="lg"
          icon="i-lucide-download"
          :loading="importing"
          :disabled="!looksLikeUrl"
          @click="importRecipe"
        >
          Import recipe
        </UButton>
      </div>
    </UCard>

    <p class="text-xs text-slate-400 dark:text-slate-500 text-center">
      Works best with sites that publish standard recipe markup — most food blogs do.
    </p>
  </div>
</template>
