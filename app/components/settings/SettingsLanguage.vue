<!-- The board's language. Household-wide, like the font and the TV theme —
     a shared kitchen tablet that reads differently depending on who last
     touched it is worse than one language everybody agrees on. -->
<script setup lang="ts">
import { LOCALE_DEFS, DEFAULT_LOCALE } from '#shared/schemas/locales'

const toast = useToast()
const { state, refresh, isAdmin } = useBoardState()
const { setLocale } = useI18n()

const chosen = ref(state.value?.settings?.locale ?? DEFAULT_LOCALE)
const busy = ref(false)

async function save() {
  busy.value = true
  try {
    await $fetch('/api/household', {
      method: 'PATCH',
      body: { settings: { locale: chosen.value } },
    })
    // Applied before the toast, so the confirmation is already in the new
    // language — otherwise the first thing the new language says is English.
    await setLocale(chosen.value as 'en')
    await refresh()
    toast.add({ title: t('settings.language.saved'), icon: 'i-lucide-check', color: 'success' })
  }
  catch {
    toast.add({ title: t('common.errors.couldNotSave'), color: 'error' })
  }
  finally {
    busy.value = false
  }
}

const { t } = useI18n()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-languages" class="text-primary size-5" />
        {{ $t('settings.language.title') }}
      </div>
    </template>

    <div class="space-y-4">
      <UFormField :label="$t('settings.language.label')" :help="$t('settings.language.help')">
        <div class="flex flex-wrap gap-2">
          <!-- Each name is written in its own language: somebody who has
               landed in a language they can't read still has to find theirs. -->
          <UButton
            v-for="l in LOCALE_DEFS"
            :key="l.code"
            :label="l.name"
            :lang="l.code"
            :variant="chosen === l.code ? 'solid' : 'soft'"
            :color="chosen === l.code ? 'primary' : 'neutral'"
            class="min-h-11"
            :disabled="!isAdmin"
            @click="chosen = l.code"
          />
        </div>
      </UFormField>

      <UButton v-if="isAdmin" :loading="busy" @click="save">
        {{ $t('common.actions.save') }}
      </UButton>
      <p v-else class="text-sm text-slate-500 dark:text-slate-400">
        {{ $t('settings.language.adminOnly') }}
      </p>
    </div>
  </UCard>
</template>
