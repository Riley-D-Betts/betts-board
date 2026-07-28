<script setup lang="ts">
const toast = useToast()
const { t } = useI18n()

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
    toast.add({ title: t('recipes.import.imported'), description: recipe.title, icon: 'i-lucide-chef-hat', color: 'success' })
    await navigateTo(`/recipes/${recipe.id}/edit`)
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string }
    errorMessage.value = e.data?.statusMessage ?? e.statusMessage
      ?? t('recipes.import.failed')
    importing.value = false
  }
}

const creating = ref(false)

async function enterManually() {
  if (creating.value) return
  creating.value = true
  try {
    const recipe = await $fetch('/api/recipes', { method: 'POST', body: { title: t('recipes.defaultTitle') } })
    await navigateTo(`/recipes/${recipe.id}/edit`)
  }
  catch {
    toast.add({ title: t('recipes.couldNotCreate'), color: 'error' })
    creating.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-xl">
    <div class="flex items-center gap-2">
      <UButton to="/recipes" icon="i-lucide-arrow-left" variant="ghost" color="neutral" :aria-label="$t('recipes.backToList')" />
      <h1 class="text-2xl md:text-3xl font-bold">{{ $t('recipes.import.title') }}</h1>
    </div>

    <UCard>
      <div class="space-y-4">
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {{ $t('recipes.import.intro') }}
        </p>

        <UFormField :label="$t('recipes.import.linkLabel')">
          <UInput
            v-model="url"
            type="url"
            :placeholder="$t('recipes.import.linkPlaceholder')"
            icon="i-lucide-link"
            size="lg"
            class="w-full"
            :disabled="importing"
            @keydown.enter="importRecipe"
          />
        </UFormField>

        <div v-if="importing" class="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          {{ $t('recipes.import.fetching') }}
        </div>

        <div
          v-else-if="errorMessage"
          class="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300 space-y-2"
        >
          <p>{{ errorMessage }}</p>
          <UButton variant="link" color="error" size="sm" class="px-0" :loading="creating" @click="enterManually">
            {{ $t('recipes.import.manualInstead') }}
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
          {{ $t('recipes.import.submit') }}
        </UButton>
      </div>
    </UCard>

    <p class="text-xs text-slate-400 dark:text-slate-500 text-center">
      {{ $t('recipes.import.footnote') }}
    </p>
  </div>
</template>
