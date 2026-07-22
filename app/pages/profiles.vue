<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const { state, switchProfile } = useBoardState()
const busy = ref<string | null>(null)

async function pick(profileId: string) {
  busy.value = profileId
  try {
    await switchProfile(profileId)
    await navigateTo('/')
  }
  finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="text-center space-y-8">
    <h1 class="text-3xl font-bold text-slate-800 dark:text-slate-100">Who's using the board?</h1>
    <div class="flex flex-wrap justify-center gap-6">
      <button
        v-for="p in state?.profiles ?? []"
        :key="p.id"
        class="group flex flex-col items-center gap-2 rounded-xl p-4 transition-transform hover:scale-105 focus-visible:scale-105"
        :disabled="busy !== null"
        @click="pick(p.id)"
      >
        <ProfileAvatar :profile="p" size="xl" />
        <span class="font-semibold text-lg text-slate-700 dark:text-slate-200 group-hover:text-primary">
          {{ p.name }}
        </span>
      </button>
    </div>
  </div>
</template>
