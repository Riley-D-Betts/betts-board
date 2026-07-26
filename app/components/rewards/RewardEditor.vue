<script setup lang="ts">
import type { RewardDef } from '~/components/rewards/RewardCard.vue'

const props = defineProps<{
  /** null = create a new reward. */
  reward?: RewardDef | null
}>()

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const toast = useToast()

const EMOJIS = [
  '🍦', '🍕', '🍩', '🍿', '🧁', '🍭',
  '🎮', '📱', '🎬', '🎧', '📚', '🎨',
  '⚽', '🎳', '🏊', '🚲', '🎢', '🏕️',
  '🧸', '🎁', '💵', '🛌', '🌟', '🐠',
]

const form = reactive({
  title: '',
  emoji: null as string | null,
  description: '',
  cost: 5,
})

watch(open, (isOpen) => {
  if (!isOpen) return
  form.title = props.reward?.title ?? ''
  form.emoji = props.reward?.emoji ?? null
  form.description = props.reward?.description ?? ''
  form.cost = props.reward?.cost ?? 5
})

const valid = computed(() => form.title.trim().length > 0 && form.cost >= 1)

const busy = ref(false)

async function save() {
  if (!valid.value) return
  busy.value = true
  const body = {
    title: form.title.trim(),
    emoji: form.emoji,
    description: form.description.trim() || null,
    cost: form.cost,
  }
  try {
    if (props.reward) {
      await $fetch(`/api/rewards/${props.reward.id}`, { method: 'PATCH', body })
    }
    else {
      await $fetch('/api/rewards', { method: 'POST', body })
    }
    open.value = false
    emit('saved')
  }
  catch {
    toast.add({ title: 'Could not save reward', color: 'error' })
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="reward ? 'Edit reward' : 'New reward'">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Title">
          <UInput v-model="form.title" placeholder="Ice cream trip" class="w-full" size="lg" autofocus />
        </UFormField>

        <EmojiField v-model="form.emoji" :presets="EMOJIS" />

        <UFormField label="Cost in stars">
          <div class="flex items-center gap-3">
            <UButton
              icon="i-lucide-minus"
              variant="soft"
              color="neutral"
              size="lg"
              :disabled="form.cost <= 1"
              @click="form.cost = Math.max(1, form.cost - 1)"
            />
            <span class="w-12 text-center text-xl font-bold tabular-nums">{{ form.cost }}</span>
            <UButton
              icon="i-lucide-plus"
              variant="soft"
              color="neutral"
              size="lg"
              :disabled="form.cost >= 1000"
              @click="form.cost = Math.min(1000, form.cost + 1)"
            />
          </div>
        </UFormField>

        <UFormField label="Description" hint="optional">
          <UTextarea v-model="form.description" :rows="2" class="w-full" placeholder="One scoop at the shop downtown" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="open = false">Cancel</UButton>
        <UButton :disabled="!valid" :loading="busy" @click="save">
          {{ reward ? 'Save changes' : 'Add reward' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
