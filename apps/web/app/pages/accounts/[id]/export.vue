<script setup lang="ts">
import type { AccountDto, Dataset, ExportFileDto, ExportFormat, Granularity } from '@fatoff/contracts'

const api = useApi()
const { t } = useI18n()
const route = useRoute()
const id = route.params.id as string

const account = ref<AccountDto | null>(null)
const error = ref('')
const busy = ref(false)
const result = ref<ExportFileDto | null>(null)

const from = ref('')
const to = ref('')
const granularity = ref<Granularity>('auto')
const redact = ref(false)

const FORMATS: ExportFormat[] = ['markdown', 'json', 'toon', 'csv']

const DATASETS: Dataset[] = [
  'diary',
  'products',
  'recipes',
  'activity',
  'water',
  'goals',
  'weight',
  'body-values',
  'feelings',
  'streak',
  'account',
  'fasting',
]

const formats = ref<ExportFormat[]>(['markdown'])
const datasets = ref<Dataset[]>([...DATASETS])

onMounted(async () => {
  try {
    account.value = await api.get<AccountDto>(`/accounts/${id}`)
    from.value = account.value.storedFrom ?? ''
    to.value = account.value.storedTo ?? ''
  } catch (caught) {
    error.value = errorMessage(caught)
  }
})

async function build(): Promise<void> {
  busy.value = true
  error.value = ''
  result.value = null
  try {
    result.value = await api.post<ExportFileDto>(`/accounts/${id}/exports`, {
      from: from.value || undefined,
      to: to.value || undefined,
      formats: formats.value,
      datasets: datasets.value.length === DATASETS.length ? undefined : datasets.value,
      granularity: granularity.value,
      redact: redact.value,
    })
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

const size = (bytes: number): string =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} МБ`
    : `${Math.max(Math.round(bytes / 1024), 1)} КБ`
</script>

<template>
  <div>
    <PageHead :title="t('nav.export')" :back="`/accounts/${id}`">
      {{ t('export.lede') }}
      <NuxtLink to="/fields">{{ t('data.fieldsLink') }}</NuxtLink>
    </PageHead>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>

    <div class="card">
      <h3>{{ t('common.period') }}</h3>
      <div class="row row--wrap" style="align-items: flex-end; gap: 0.75rem">
        <label class="field" style="margin: 0; width: 10rem">
          <span>{{ t('common.from') }}</span>
          <DateField v-model="from" no-future />
        </label>
        <label class="field" style="margin: 0; width: 10rem">
          <span>{{ t('common.to') }}</span>
          <DateField v-model="to" no-future />
        </label>
        <label class="field" style="margin: 0; width: 12rem">
          <span>{{ t('export.digestRow') }}</span>
          <select v-model="granularity">
            <option value="auto">{{ t('export.auto') }}</option>
            <option value="day">{{ t('export.granularity.day') }}</option>
            <option value="week">{{ t('export.granularity.week') }}</option>
            <option value="month">{{ t('export.granularity.month') }}</option>
          </select>
        </label>
      </div>
      <p v-if="account?.storedFrom" class="tiny">
        {{ t('export.storedRange', { from: account.storedFrom, to: account.storedTo }) }}
      </p>
    </div>

    <div class="card">
      <h3>{{ t('export.formats') }}</h3>
      <div class="stack" style="gap: 0.3rem">
        <label v-for="format in FORMATS" :key="format" class="check" style="align-items: flex-start">
          <input v-model="formats" type="checkbox" :value="format" style="margin-top: 0.55rem" />
          <span>
            <strong>{{ format === 'markdown' ? t('format.markdown') : format.toUpperCase() }}</strong>
            <span class="tiny"> — {{ t(`format.${format}.note`) }}</span>
          </span>
        </label>
      </div>
      <p class="tiny" style="margin-bottom: 0">{{ t('export.zipNote') }}</p>
    </div>

    <div class="card">
      <h3>{{ t('export.datasets') }}</h3>
      <div class="checks">
        <label v-for="dataset in DATASETS" :key="dataset" class="check">
          <input v-model="datasets" type="checkbox" :value="dataset" />
          {{ t(`dataset.${dataset}`) }}
        </label>
      </div>
      <label class="check" style="margin-top: 0.5rem">
        <input v-model="redact" type="checkbox" />
        {{ t('export.redact.label') }}
      </label>
      <p class="tiny" style="margin-bottom: 0">
        {{ t('export.redact.note') }}
      </p>
    </div>

    <div class="row" style="margin-top: 1rem">
      <button class="btn btn--primary" :disabled="busy || formats.length === 0" @click="build">
        <span v-if="busy" class="spinner" />
        {{ t('export.build') }}
      </button>
    </div>

    <template v-if="result">
      <h2>{{ t('export.ready') }}</h2>
      <div class="card">
        <div class="row row--between row--wrap">
          <div class="grow">
            <strong class="mono">{{ result.fileName }}</strong>
            <div class="tiny">
              {{ result.from }} — {{ result.to }} · {{ size(result.sizeBytes) }} ·
              таблиц: {{ result.tables.length }}
            </div>
          </div>
          <a class="btn btn--primary" :href="`/api/exports/${result.id}/download`">Скачать</a>
        </div>

        <details style="margin-top: 0.75rem">
          <summary class="muted">Что внутри</summary>
          <div class="table-wrap" style="margin-top: 0.5rem">
            <table class="data">
              <thead>
                <tr>
                  <th>Таблица</th>
                  <th class="num">Строк</th>
                  <th class="num">Колонок</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in result.tables" :key="item.name">
                  <td class="mono">{{ item.name }}</td>
                  <td class="num mono">{{ item.rows }}</td>
                  <td class="num mono">{{ item.columns }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </template>
  </div>
</template>
