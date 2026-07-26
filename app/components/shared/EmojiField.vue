<!-- Emoji picker with a free-text escape hatch, shared by the chore and reward
     editors. The presets are a shortcut, not the vocabulary: anything you can
     type or paste is accepted (validated as a single grapheme server-side). -->
<script setup lang="ts">
const props = withDefaults(defineProps<{
  presets?: string[]
  label?: string
}>(), {
  presets: () => [],
  label: 'Emoji',
})

const model = defineModel<string | null>({ required: true })

const typed = ref('')

/** Keep only the first grapheme — pasting a sentence shouldn't 400 on save. */
function firstGrapheme(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const { segment } of segmenter.segment(trimmed)) return segment
  return null
}

function commitTyped() {
  const first = firstGrapheme(typed.value)
  if (first) model.value = first
  typed.value = ''
}

function pick(emoji: string) {
  model.value = model.value === emoji ? null : emoji
}
</script>

<template>
  <UFormField :label="props.label">
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <div
          class="flex size-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-2xl"
          :aria-label="model ? `Selected ${model}` : 'No emoji selected'"
        >
          <span v-if="model">{{ model }}</span>
          <UIcon v-else name="i-lucide-smile-plus" class="size-5 text-slate-400" />
        </div>
        <UInput
          v-model="typed"
          class="flex-1"
          placeholder="Type or paste any emoji"
          autocapitalize="off"
          autocomplete="off"
          @change="commitTyped"
          @blur="commitTyped"
          @keydown.enter.prevent="commitTyped"
        />
        <UButton
          v-if="model"
          icon="i-lucide-x"
          variant="ghost"
          color="neutral"
          aria-label="Clear emoji"
          @click="model = null"
        />
      </div>

      <div v-if="props.presets.length" class="grid grid-cols-6 gap-1">
        <button
          v-for="e in props.presets"
          :key="e"
          type="button"
          class="size-11 rounded-lg text-2xl transition-colors"
          :class="model === e
            ? 'bg-primary/15 ring-2 ring-primary'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800'"
          @click="pick(e)"
        >
          {{ e }}
        </button>
      </div>
    </div>
  </UFormField>
</template>
