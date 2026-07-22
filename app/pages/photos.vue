<script setup lang="ts">
import type { PhotoDto } from '#shared/schemas/photos'

const PAGE_SIZE = 50
const MAX_FILE_BYTES = 25 * 1024 * 1024

const toast = useToast()

// First page is SSR-visible; later pages append client-side via the id cursor.
const { data: firstPage, refresh: refreshFirst } = await useFetch<PhotoDto[]>('/api/photos', {
  query: { limit: PAGE_SIZE },
  default: () => [],
})
const morePages = ref<PhotoDto[]>([])
const endReached = ref(false)

const photos = computed(() => [...(firstPage.value ?? []), ...morePages.value])
const hasMore = computed(() =>
  !endReached.value
  && (firstPage.value?.length ?? 0) === PAGE_SIZE
  && photos.value.length % PAGE_SIZE === 0)

const loadingMore = ref(false)
async function loadMore() {
  const cursor = photos.value.at(-1)?.id
  if (!cursor || loadingMore.value) return
  loadingMore.value = true
  try {
    const batch = await $fetch<PhotoDto[]>('/api/photos', { query: { cursor, limit: PAGE_SIZE } })
    morePages.value.push(...batch)
    if (batch.length < PAGE_SIZE) endReached.value = true
  }
  catch {
    toast.add({ title: 'Could not load more photos', color: 'error' })
  }
  finally {
    loadingMore.value = false
  }
}

async function reloadAll() {
  morePages.value = []
  endReached.value = false
  await refreshFirst()
}

// ---- upload (multi-file picker + drag-drop) with progress ----

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadProgress = ref(0)
const uploadCount = ref(0)

function pickFiles() {
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) void upload([...input.files])
  input.value = '' // allow re-picking the same files
}

const dragDepth = ref(0)
function onDragEnter() {
  dragDepth.value++
}
function onDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}
function onDrop(e: DragEvent) {
  dragDepth.value = 0
  const files = [...(e.dataTransfer?.files ?? [])]
  if (files.length) void upload(files)
}

async function upload(files: File[]) {
  if (uploading.value) return
  const images = files.filter(f => f.type.startsWith('image/'))
  if (!images.length) {
    toast.add({ title: 'Only image files can be uploaded', color: 'error' })
    return
  }
  const tooBig = images.find(f => f.size > MAX_FILE_BYTES)
  if (tooBig) {
    toast.add({ title: `${tooBig.name} is larger than 25 MB`, color: 'error' })
    return
  }

  uploading.value = true
  uploadProgress.value = 0
  uploadCount.value = images.length
  try {
    // XHR instead of $fetch: fetch() has no upload-progress events.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/photos')
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) uploadProgress.value = Math.round((ev.loaded / ev.total) * 100)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve()
        let message = `Upload failed (${xhr.status})`
        try {
          message = (JSON.parse(xhr.responseText) as { statusMessage?: string }).statusMessage ?? message
        }
        catch { /* keep the generic message */ }
        reject(new Error(message))
      }
      xhr.onerror = () => reject(new Error('Upload failed'))
      const fd = new FormData()
      for (const f of images) fd.append('files', f, f.name)
      xhr.send(fd)
    })
    toast.add({
      title: images.length === 1 ? 'Photo added' : `${images.length} photos added`,
      icon: 'i-lucide-image-plus',
      color: 'success',
    })
    await reloadAll()
  }
  catch (e) {
    toast.add({ title: (e as Error).message || 'Upload failed', color: 'error' })
  }
  finally {
    uploading.value = false
  }
}

// ---- per-photo actions ----

/** Tapped photo id — shows the action overlay on touch devices (no hover). */
const tappedId = ref<string | null>(null)
function onPhotoTap(p: PhotoDto) {
  tappedId.value = tappedId.value === p.id ? null : p.id
}

function replaceLocal(updated: PhotoDto) {
  for (const arr of [firstPage.value ?? [], morePages.value]) {
    const i = arr.findIndex(x => x.id === updated.id)
    if (i >= 0) arr[i] = updated
  }
}

async function toggleSlideshow(p: PhotoDto) {
  try {
    const updated = await $fetch<PhotoDto>(`/api/photos/${p.id}`, {
      method: 'PATCH',
      body: { inSlideshow: !p.inSlideshow },
    })
    replaceLocal(updated)
  }
  catch {
    toast.add({ title: 'Could not update photo', color: 'error' })
  }
}

const pendingDelete = ref<PhotoDto | null>(null)
const deleting = ref(false)
async function confirmDelete() {
  if (!pendingDelete.value) return
  deleting.value = true
  try {
    await $fetch(`/api/photos/${pendingDelete.value.id}`, { method: 'DELETE' })
    pendingDelete.value = null
    toast.add({ title: 'Photo deleted', color: 'success' })
    await reloadAll()
  }
  catch {
    toast.add({ title: 'Could not delete photo', color: 'error' })
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div
    class="space-y-6"
    @dragover.prevent
    @dragenter.prevent="onDragEnter"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-2xl md:text-3xl font-bold flex-1">Photos</h1>
      <UButton icon="i-lucide-image-plus" :loading="uploading" @click="pickFiles">
        Add photos
      </UButton>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="onFileChange"
      >
    </div>

    <div v-if="uploading" class="space-y-1">
      <p class="text-sm text-slate-500 dark:text-slate-400">
        Uploading {{ uploadCount === 1 ? 'photo' : `${uploadCount} photos` }}…
      </p>
      <UProgress :model-value="uploadProgress" />
    </div>

    <!-- Drop target highlight -->
    <div
      v-if="dragDepth > 0"
      class="rounded-xl border-2 border-dashed border-primary bg-primary/5 p-8 text-center text-primary font-medium"
    >
      Drop photos to upload
    </div>

    <div v-if="!photos.length && !uploading" class="py-16 text-center text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-images" class="size-10 mb-2" />
      <p>No photos yet. Add some and they'll show up in the slideshow.</p>
      <UButton variant="soft" class="mt-3" icon="i-lucide-image-plus" @click="pickFiles">
        Add photos
      </UButton>
    </div>

    <!-- Masonry-ish grid via CSS columns -->
    <div v-else class="columns-2 gap-3 sm:columns-3 lg:columns-4">
      <div
        v-for="p in photos"
        :key="p.id"
        class="group relative mb-3 break-inside-avoid overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800"
      >
        <img
          :src="p.thumbUrl"
          :width="p.width"
          :height="p.height"
          alt=""
          loading="lazy"
          class="block h-auto w-full"
          @click="onPhotoTap(p)"
        >
        <div
          v-if="!p.inSlideshow"
          class="pointer-events-none absolute left-2 top-2 rounded-full bg-black/50 p-1.5 text-white"
          title="Not in slideshow"
        >
          <UIcon name="i-lucide-monitor-off" class="block size-4" />
        </div>
        <div
          class="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          :class="{ 'opacity-100': tappedId === p.id }"
        >
          <UButton
            :icon="p.inSlideshow ? 'i-lucide-monitor-check' : 'i-lucide-monitor-off'"
            variant="ghost"
            :color="p.inSlideshow ? 'primary' : 'neutral'"
            class="size-11 justify-center text-white"
            :title="p.inSlideshow ? 'Remove from slideshow' : 'Include in slideshow'"
            :aria-label="p.inSlideshow ? 'Remove from slideshow' : 'Include in slideshow'"
            @click="toggleSlideshow(p)"
          />
          <UButton
            icon="i-lucide-trash-2"
            variant="ghost"
            color="error"
            class="size-11 justify-center"
            title="Delete photo"
            aria-label="Delete photo"
            @click="pendingDelete = p"
          />
        </div>
      </div>
    </div>

    <div v-if="hasMore" class="flex justify-center">
      <UButton variant="soft" color="neutral" :loading="loadingMore" @click="loadMore">
        Load more
      </UButton>
    </div>

    <!-- Delete confirmation -->
    <UModal :open="!!pendingDelete" title="Delete photo?" @update:open="(v: boolean) => { if (!v) pendingDelete = null }">
      <template #body>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          This removes the photo from the board and the slideshow. There's no undo.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="pendingDelete = null">Cancel</UButton>
          <UButton color="error" :loading="deleting" @click="confirmDelete">Delete</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
