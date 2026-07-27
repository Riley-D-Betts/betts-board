<script setup lang="ts">
const toast = useToast()
const { t } = useI18n()
const { refresh } = useBoardState()
const { data: profileList, refresh: reload } = await useFetch('/api/profiles')

const adding = ref(false)
const newProfile = reactive({ name: '', color: '#3b82f6', role: 'adult' as 'admin' | 'adult' | 'kid' })

async function addProfile() {
  if (!newProfile.name.trim()) return
  try {
    await $fetch('/api/profiles', { method: 'POST', body: { ...newProfile, name: newProfile.name.trim() } })
    newProfile.name = ''
    adding.value = false
    await Promise.all([reload(), refresh()])
  }
  catch {
    toast.add({ title: t('settings.profiles.addFailed'), color: 'error' })
  }
}

async function archiveProfile(id: string, name: string) {
  if (!confirm(t('settings.profiles.removeConfirm', { name }))) return
  await $fetch(`/api/profiles/${id}`, { method: 'DELETE' })
  await Promise.all([reload(), refresh()])
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-users" class="text-primary size-5" />
        {{ $t('settings.profiles.title') }}
      </div>
    </template>
    <div class="space-y-3">
      <div v-for="p in profileList ?? []" :key="p.id" class="flex items-center gap-3">
        <ProfileAvatar :profile="p" size="sm" />
        <span class="font-medium flex-1">{{ p.name }}</span>
        <UBadge :label="p.role" variant="soft" />
        <UButton icon="i-lucide-trash-2" variant="ghost" color="neutral" size="sm" @click="archiveProfile(p.id, p.name)" />
      </div>

      <div v-if="adding" class="flex items-center gap-2 pt-2">
        <input v-model="newProfile.color" type="color" class="size-9 rounded cursor-pointer border-0 bg-transparent shrink-0">
        <UInput v-model="newProfile.name" :placeholder="$t('settings.profiles.namePlaceholder')" class="flex-1" autofocus @keyup.enter="addProfile" />
        <USelect
          v-model="newProfile.role"
          :items="[{ label: $t('settings.profiles.roleAdmin'), value: 'admin' }, { label: $t('settings.profiles.roleAdult'), value: 'adult' }, { label: $t('settings.profiles.roleKid'), value: 'kid' }]"
          class="w-28"
        />
        <UButton icon="i-lucide-check" @click="addProfile" />
      </div>
      <UButton v-else variant="soft" icon="i-lucide-plus" @click="adding = true">{{ $t('settings.profiles.addMember') }}</UButton>
    </div>
  </UCard>
</template>
