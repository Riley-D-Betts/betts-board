<!-- Create or rename a wish list. -->
<script setup lang="ts">
import type { WishlistDto } from '#shared/schemas/wishlists'

const props = defineProps<{ list?: WishlistDto | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const toast = useToast()
const { state, activeProfile } = useBoardState()

// Presets fill the free-text field — the ergonomics of an enum without the
// rigidity, since families invent their own occasions.
const OCCASIONS = ['Birthday', 'Christmas', 'Hanukkah', 'Graduation', 'Just because']

const form = reactive({
  title: '',
  occasion: '',
  eventDate: '',
  profileId: '',
})

watch(open, (isOpen) => {
  if (!isOpen) return
  form.title = props.list?.title ?? ''
  form.occasion = props.list?.occasion ?? ''
  form.eventDate = props.list?.eventDate ?? ''
  form.profileId = props.list?.profileId ?? activeProfile.value?.id ?? ''
})

const profiles = computed(() => (state.value?.profiles ?? [])
  .map(p => ({ label: p.name, value: p.id })))

const busy = ref(false)

async function save() {
  if (!form.title.trim()) {
    toast.add({ title: 'Give the list a name first', color: 'warning' })
    return
  }
  busy.value = true
  const body = {
    title: form.title.trim(),
    occasion: form.occasion.trim() || null,
    eventDate: form.eventDate || null,
    profileId: form.profileId || undefined,
  }
  try {
    if (props.list) {
      await $fetch(`/api/wishlists/${props.list.id}`, { method: 'PATCH', body })
    }
    else {
      await $fetch('/api/wishlists', { method: 'POST', body })
    }
    open.value = false
    emit('saved')
  }
  catch (err) {
    const e = err as { data?: { statusMessage?: string } }
    toast.add({ title: e.data?.statusMessage ?? 'Could not save the list', color: 'error' })
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="props.list ? 'Edit wish list' : 'New wish list'">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Name">
          <UInput v-model="form.title" placeholder="Emma's birthday" class="w-full" size="lg" autofocus />
        </UFormField>

        <UFormField label="Who is it for">
          <USelect v-model="form.profileId" :items="profiles" class="w-full" />
        </UFormField>

        <UFormField label="Occasion" hint="optional">
          <UInput v-model="form.occasion" placeholder="Birthday" class="w-full" />
          <div class="mt-2 flex flex-wrap gap-1">
            <UButton
              v-for="o in OCCASIONS"
              :key="o"
              size="xs"
              variant="soft"
              color="neutral"
              @click="form.occasion = o"
            >
              {{ o }}
            </UButton>
          </div>
        </UFormField>

        <UFormField label="Date" hint="optional" help="Shows a countdown on the list.">
          <UInput v-model="form.eventDate" type="date" class="w-full" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="open = false">Cancel</UButton>
        <UButton :loading="busy" @click="save">Save</UButton>
      </div>
    </template>
  </UModal>
</template>
