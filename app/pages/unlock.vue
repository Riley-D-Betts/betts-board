<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const { state, refresh } = useBoardState()
const password = ref('')
const error = ref('')
const busy = ref(false)

// BETTS_RESET_PASSWORD boot: the hash is cleared and this screen sets a new one.
const resetMode = computed(() => state.value?.needsPasswordReset === true)

async function unlock() {
  if (!password.value) return
  busy.value = true
  error.value = ''
  try {
    if (resetMode.value) {
      await $fetch('/api/auth/reset-password', { method: 'POST', body: { password: password.value } })
    }
    else {
      await $fetch('/api/auth/unlock', { method: 'POST', body: { password: password.value } })
    }
    await refresh()
    await navigateTo('/profiles')
  }
  catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode
    error.value = status === 429
      ? 'Too many attempts — wait a minute.'
      : resetMode.value ? 'Could not set the password (6+ characters).' : 'Wrong password.'
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
      <p v-if="resetMode" class="text-sm text-amber-500">
        Password reset is armed — choose a new household password.
      </p>
      <form class="space-y-3 max-w-xs mx-auto" @submit.prevent="unlock">
        <UInput
          v-model="password"
          type="password"
          :placeholder="resetMode ? 'New household password' : 'Household password'"
          size="xl"
          class="w-full"
          autofocus
        />
        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
        <UButton type="submit" block size="xl" :loading="busy">
          {{ resetMode ? 'Set new password' : 'Unlock' }}
        </UButton>
      </form>
    </div>
  </UCard>
</template>
