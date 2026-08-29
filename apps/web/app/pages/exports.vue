<script setup lang="ts">
import type { ExportFileDto } from '@fatoff/contracts'

const api = useApi()
const { t, locale } = useI18n()

const items = ref<ExportFileDto[]>([])
const loading = ref(true)
const error = ref('')

async function load(): Promise<void> {
  try {
    items.value = await api.get<ExportFileDto[]>('/exports')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function remove(item: ExportFileDto): Promise<void> {
  if (!confirm(t('exports.confirm', { name: item.fileName }))) return
  try {
    await api.del(`/exports/${item.id}`)
    items.value = items.value.filter((row) => row.id !== item.id)
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

onMounted(load)

const size = (bytes: number): string =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} ${t('unit.mb')}`
    : `${Math.max(Math.round(bytes / 1024), 1)} ${t('unit.kb')}`

const when = (iso: string): string =>
  new Date(iso).toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
</script>

<template>
  <div>
    <h1>{{ t('exports.title') }}</h1>
    <p class="lede">{{ t('exports.lede') }}</p>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>
    <p v-if="loading" class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>

    <p v-else-if="items.length === 0" class="card muted">{{ t('exports.empty') }}</p>

    <div v-else class="stack">
      <div v-for="item in items" :key="item.id" class="card">
        <div class="row row--between row--wrap">
          <div class="grow">
            <strong class="mono">{{ item.fileName || '—' }}</strong>
            <div class="tiny">
              {{ item.accountLabel }} · {{ item.from }} — {{ item.to }} ·
              {{ item.formats.join(', ') }} · {{ size(item.sizeBytes) }} · {{ when(item.createdAt) }}
              <span v-if="item.redact"> · {{ t('exports.redacted') }}</span>
            </div>
          </div>
          <div class="row">
            <a
              v-if="item.status === 'done'"
              class="btn btn--small"
              :href="`/api/exports/${item.id}/download`"
              >{{ t('exports.download') }}</a
            >
            <span v-else class="chip chip--bad">{{ item.error || item.status }}</span>
            <button class="btn btn--small btn--danger" @click="remove(item)">
              {{ t('exports.remove') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
