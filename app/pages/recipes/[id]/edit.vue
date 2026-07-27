<script setup lang="ts">
import type { RecipeDetail } from '~~/server/services/recipes/recipes'

const route = useRoute()
const toast = useToast()
const { t } = useI18n()
const recipeId = route.params.id as string

// Dynamic URL defeats Nuxt's route-based response inference — type it by hand.
const { data: recipe } = await useFetch<RecipeDetail>(`/api/recipes/${recipeId}`)

if (!recipe.value) {
  throw createError({ statusCode: 404, statusMessage: t('recipes.notFound'), fatal: true })
}

const form = reactive({
  title: recipe.value!.title,
  description: recipe.value!.description ?? '',
  prepMinutes: recipe.value!.prepMinutes != null ? String(recipe.value!.prepMinutes) : '',
  cookMinutes: recipe.value!.cookMinutes != null ? String(recipe.value!.cookMinutes) : '',
  totalMinutes: recipe.value!.totalMinutes != null ? String(recipe.value!.totalMinutes) : '',
  servings: recipe.value!.servings != null ? String(recipe.value!.servings) : '',
  tags: (recipe.value!.tags ?? []).join(', '),
})

const ingredientLines = ref<string[]>(recipe.value!.ingredients.map(i => i.raw))
const stepLines = ref<string[]>([...recipe.value!.steps])

function addLine(list: string[]) {
  list.push('')
}

function removeLine(list: string[], i: number) {
  list.splice(i, 1)
}

function moveLine(list: string[], i: number, delta: -1 | 1) {
  const j = i + delta
  if (j < 0 || j >= list.length) return
  const [item] = list.splice(i, 1)
  list.splice(j, 0, item!)
}

function toIntOrNull(s: string): number | null {
  const n = Number.parseInt(s.trim(), 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function toNumOrNull(s: string): number | null {
  const n = Number.parseFloat(s.trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

const saving = ref(false)

async function save() {
  const title = form.title.trim()
  if (!title) {
    toast.add({ title: t('recipes.edit.titleRequired'), color: 'warning' })
    return
  }
  saving.value = true
  try {
    await $fetch(`/api/recipes/${recipeId}`, {
      method: 'PATCH',
      body: {
        title,
        description: form.description.trim() || null,
        prepMinutes: toIntOrNull(form.prepMinutes),
        cookMinutes: toIntOrNull(form.cookMinutes),
        totalMinutes: toIntOrNull(form.totalMinutes),
        servings: toNumOrNull(form.servings),
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        steps: stepLines.value.map(s => s.trim()).filter(Boolean),
        ingredients: ingredientLines.value
          .map(raw => raw.trim())
          .filter(Boolean)
          .map(raw => ({ raw })),
      },
    })
    toast.add({ title: t('recipes.edit.saved'), icon: 'i-lucide-check', color: 'success' })
    await navigateTo(`/recipes/${recipeId}`)
  }
  catch {
    toast.add({ title: t('recipes.edit.couldNotSave'), color: 'error' })
    saving.value = false
  }
}
</script>

<template>
  <div v-if="recipe" class="space-y-6 max-w-2xl">
    <div class="flex items-center gap-2">
      <UButton
        :to="`/recipes/${recipeId}`"
        icon="i-lucide-arrow-left"
        variant="ghost"
        color="neutral"
        :aria-label="$t('recipes.edit.back')"
      />
      <h1 class="text-2xl md:text-3xl font-bold flex-1 truncate">{{ $t('recipes.edit.title') }}</h1>
      <UButton icon="i-lucide-check" :loading="saving" @click="save">{{ $t('common.actions.save') }}</UButton>
    </div>

    <img
      v-if="recipe.imagePath"
      :src="`/uploads/${recipe.imagePath}`"
      :alt="recipe.title"
      class="w-full max-h-56 object-cover rounded-2xl"
    >

    <div class="space-y-4">
      <UFormField :label="$t('recipes.edit.fields.title')" required>
        <UInput v-model="form.title" size="lg" class="w-full" :placeholder="$t('recipes.edit.fields.titlePlaceholder')" />
      </UFormField>

      <UFormField :label="$t('recipes.edit.fields.description')">
        <UTextarea
          v-model="form.description"
          :rows="3"
          autoresize
          class="w-full"
          :placeholder="$t('recipes.edit.fields.descriptionPlaceholder')"
        />
      </UFormField>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <UFormField :label="$t('recipes.edit.fields.prep')">
          <UInput v-model="form.prepMinutes" type="number" min="0" inputmode="numeric" />
        </UFormField>
        <UFormField :label="$t('recipes.edit.fields.cook')">
          <UInput v-model="form.cookMinutes" type="number" min="0" inputmode="numeric" />
        </UFormField>
        <UFormField :label="$t('recipes.edit.fields.total')">
          <UInput v-model="form.totalMinutes" type="number" min="0" inputmode="numeric" />
        </UFormField>
        <UFormField :label="$t('recipes.edit.fields.servings')">
          <UInput v-model="form.servings" type="number" min="0" inputmode="decimal" />
        </UFormField>
      </div>

      <UFormField :label="$t('recipes.edit.fields.tags')" :help="$t('recipes.edit.fields.tagsHelp')">
        <UInput v-model="form.tags" class="w-full" :placeholder="$t('recipes.edit.fields.tagsPlaceholder')" />
      </UFormField>
    </div>

    <!-- Ingredients -->
    <section class="space-y-2">
      <h2 class="text-lg font-semibold">{{ $t('recipes.edit.ingredients.title') }}</h2>
      <p v-if="!ingredientLines.length" class="text-sm text-slate-500 dark:text-slate-400">
        {{ $t('recipes.edit.ingredients.empty') }}
      </p>
      <div v-for="(line, i) in ingredientLines" :key="`ing-${i}`" class="flex items-start gap-1.5">
        <div class="flex flex-col shrink-0">
          <UButton
            icon="i-lucide-chevron-up"
            variant="ghost"
            color="neutral"
            size="xs"
            :disabled="i === 0"
            :aria-label="$t('recipes.edit.ingredients.moveUp', { n: i + 1 })"
            @click="moveLine(ingredientLines, i, -1)"
          />
          <UButton
            icon="i-lucide-chevron-down"
            variant="ghost"
            color="neutral"
            size="xs"
            :disabled="i === ingredientLines.length - 1"
            :aria-label="$t('recipes.edit.ingredients.moveDown', { n: i + 1 })"
            @click="moveLine(ingredientLines, i, 1)"
          />
        </div>
        <UTextarea
          v-model="ingredientLines[i]"
          :rows="1"
          autoresize
          class="flex-1"
          :placeholder="$t('recipes.edit.ingredients.placeholder')"
        />
        <UButton
          icon="i-lucide-x"
          variant="ghost"
          color="neutral"
          :aria-label="$t('recipes.edit.ingredients.remove', { n: i + 1 })"
          @click="removeLine(ingredientLines, i)"
        />
      </div>
      <UButton icon="i-lucide-plus" variant="soft" color="neutral" size="sm" @click="addLine(ingredientLines)">
        {{ $t('recipes.edit.ingredients.add') }}
      </UButton>
    </section>

    <!-- Steps -->
    <section class="space-y-2">
      <h2 class="text-lg font-semibold">{{ $t('recipes.edit.steps.title') }}</h2>
      <p v-if="!stepLines.length" class="text-sm text-slate-500 dark:text-slate-400">
        {{ $t('recipes.edit.steps.empty') }}
      </p>
      <div v-for="(line, i) in stepLines" :key="`step-${i}`" class="flex items-start gap-1.5">
        <span class="mt-2 size-7 shrink-0 rounded-full bg-primary/10 text-primary text-sm font-semibold flex items-center justify-center">
          {{ i + 1 }}
        </span>
        <div class="flex flex-col shrink-0">
          <UButton
            icon="i-lucide-chevron-up"
            variant="ghost"
            color="neutral"
            size="xs"
            :disabled="i === 0"
            :aria-label="$t('recipes.edit.steps.moveUp', { n: i + 1 })"
            @click="moveLine(stepLines, i, -1)"
          />
          <UButton
            icon="i-lucide-chevron-down"
            variant="ghost"
            color="neutral"
            size="xs"
            :disabled="i === stepLines.length - 1"
            :aria-label="$t('recipes.edit.steps.moveDown', { n: i + 1 })"
            @click="moveLine(stepLines, i, 1)"
          />
        </div>
        <UTextarea
          v-model="stepLines[i]"
          :rows="2"
          autoresize
          class="flex-1"
          :placeholder="$t('recipes.edit.steps.placeholder')"
        />
        <UButton
          icon="i-lucide-x"
          variant="ghost"
          color="neutral"
          :aria-label="$t('recipes.edit.steps.remove', { n: i + 1 })"
          @click="removeLine(stepLines, i)"
        />
      </div>
      <UButton icon="i-lucide-plus" variant="soft" color="neutral" size="sm" @click="addLine(stepLines)">
        {{ $t('recipes.edit.steps.add') }}
      </UButton>
    </section>

    <div class="flex justify-end gap-2 pb-8">
      <UButton :to="`/recipes/${recipeId}`" variant="ghost" color="neutral">{{ $t('common.actions.cancel') }}</UButton>
      <UButton icon="i-lucide-check" size="lg" :loading="saving" @click="save">{{ $t('recipes.edit.save') }}</UButton>
    </div>
  </div>
</template>
