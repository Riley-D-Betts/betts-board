<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const { state, refresh } = useBoardState()
const { t } = useI18n()
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
    if (status === 429) {
      error.value = t('auth.unlock.errors.tooManyAttempts')
    }
    else if (status === 401) {
      error.value = t('auth.unlock.errors.wrongPassword')
    }
    else if (status === 400) {
      error.value = resetMode.value
        ? t('auth.unlock.errors.passwordTooShort')
        : t('auth.unlock.errors.wrongPassword')
    }
    else {
      // Don't blame the user's typing for server/network failures.
      error.value = t('auth.unlock.errors.server', { code: status ?? t('auth.unlock.errors.networkFallback') })
    }
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
        {{ $t('auth.unlock.resetNotice') }}
      </p>
      <form class="space-y-3 max-w-xs mx-auto" @submit.prevent="unlock">
        <UInput
          v-model="password"
          type="password"
          :placeholder="resetMode ? $t('auth.unlock.newPasswordPlaceholder') : $t('auth.unlock.passwordPlaceholder')"
          size="xl"
          class="w-full"
          autofocus
        />
        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
        <UButton type="submit" block size="xl" :loading="busy">
          {{ resetMode ? $t('auth.unlock.submitReset') : $t('auth.unlock.submit') }}
        </UButton>
      </form>
    </div>
  </UCard>
</template>
