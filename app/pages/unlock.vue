<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const { state, refresh } = useBoardState()
const password = ref('')
const error = ref('')
const busy = ref(false)

async function unlock() {
  if (!password.value) return
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/unlock', { method: 'POST', body: { password: password.value } })
    await refresh()
    await navigateTo('/profiles')
  }
  catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode
    error.value = status === 429 ? 'Too many attempts — wait a minute.' : 'Wrong password.'
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UCard>
    <div class="text-center space-y-4 py-4">
      <UIcon name="i-lucide-lock" class="text-primary size-10" />
      <h1 class="text-2xl font-bold">{{ state?.householdName ?? 'Betts Board' }}</h1>
      <form class="space-y-3 max-w-xs mx-auto" @submit.prevent="unlock">
        <UInput
          v-model="password"
          type="password"
          placeholder="Household password"
          size="xl"
          class="w-full"
          autofocus
        />
        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
        <UButton type="submit" block size="xl" :loading="busy">Unlock</UButton>
      </form>
    </div>
  </UCard>
</template>
