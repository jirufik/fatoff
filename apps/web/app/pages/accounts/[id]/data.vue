<script setup lang="ts">
import {
  BROWSE_TABLES,
  MEAL_TITLES,
  type AccountDto,
  type DayRowDto,
  type DiaryRowDto,
  type HealthDayRowDto,
  type HealthSleepRowDto,
  type HealthWorkoutRowDto,
  type MeasurementRowDto,
  type MealKey,
  type PageDto,
  type ProductRowDto,
} from '@fatoff/contracts'

const api = useApi()
const { t, pick } = useI18n()
const route = useRoute()
const id = route.params.id as string

type Tab = 'diary' | 'days' | 'products' | 'measurements' | 'health' | 'workouts' | 'sleep'

const KIND_KEYS = ['product', 'recipe_portion', 'simple_product'] as const
const MEASURE_KEYS = ['weight', 'body_fat', 'muscle_ratio', 'waist', 'hip', 'chest'] as const

const TABS: Array<{ key: Tab; health?: boolean }> = [
  { key: 'diary' },
  { key: 'days' },
  { key: 'products' },
  { key: 'measurements' },
  { key: 'health', health: true },
  { key: 'workouts', health: true },
  { key: 'sleep', health: true },
]

const account = ref<AccountDto | null>(null)
const tab = ref<Tab>('diary')
const error = ref('')
const loading = ref(false)

const rows = ref<unknown[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)

// фильтры общие и по вкладкам
const from = ref('')
const to = ref('')
const search = ref('')
const meal = ref('')
const kind = ref('')
const withFood = ref(false)
const measureKind = ref('')
const sort = ref('')
const dir = ref<'asc' | 'desc'>('desc')

const doc = computed(() => BROWSE_TABLES.find((table) => table.name === tab.value)!)

const diaryRows = computed(() => rows.value as DiaryRowDto[])
const dayRows = computed(() => rows.value as DayRowDto[])
const productRows = computed(() => rows.value as ProductRowDto[])
const measurementRows = computed(() => rows.value as MeasurementRowDto[])
const healthRows = computed(() => rows.value as HealthDayRowDto[])
const workoutRows = computed(() => rows.value as HealthWorkoutRowDto[])
const sleepRows = computed(() => rows.value as HealthSleepRowDto[])

function params(): Record<string, string> {
  const query: Record<string, string> = {
    page: String(page.value),
    pageSize: String(pageSize.value),
    dir: dir.value,
  }
  if (from.value) query.from = from.value
  if (to.value) query.to = to.value
  if (sort.value) query.sort = sort.value

  if (tab.value === 'diary') {
    if (meal.value) query.meal = meal.value
    if (kind.value) query.kind = kind.value
    if (search.value.trim()) query.search = search.value.trim()
  }
  if (tab.value === 'days' && withFood.value) query.withFood = 'true'
  if (tab.value === 'products' && search.value.trim()) query.search = search.value.trim()
  if (tab.value === 'measurements' && measureKind.value) query.kind = measureKind.value

  return query
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const query = new URLSearchParams(params()).toString()
    const result = await api.get<PageDto<unknown>>(`/accounts/${id}/data/${tab.value}?${query}`)
    rows.value = result.items
    total.value = result.total
  } catch (caught) {
    error.value = errorMessage(caught)
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/** Поиск ждёт, пока перестанут печатать: запрос на каждую букву незачем. */
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    void load()
  }, 350)
})

watch([tab, meal, kind, withFood, measureKind, from, to, sort, dir], () => {
  page.value = 1
  void load()
})
watch([page, pageSize], load)

/**
 * Смена вкладки сбрасывает и фильтры, и сами строки. Строки — обязательно:
 * разметка переключается сразу, а ответ приходит позже, и старые строки успели
 * бы отрисоваться в колонках чужой вкладки.
 */
watch(tab, () => {
  rows.value = []
  total.value = 0
  search.value = ''
  meal.value = ''
  kind.value = ''
  measureKind.value = ''
  sort.value = ''
  dir.value = 'desc'
})

onMounted(async () => {
  try {
    account.value = await api.get<AccountDto>(`/accounts/${id}`)
  } catch (caught) {
    error.value = errorMessage(caught)
  }
  await load()
})

/** Клик по заголовку колонки: первый раз — сортировка, второй — разворот. */
function sortBy(column: string): void {
  if (sort.value === column) dir.value = dir.value === 'desc' ? 'asc' : 'desc'
  else {
    sort.value = column
    dir.value = 'desc'
  }
}

const arrow = (column: string): string => (sort.value === column ? (dir.value === 'desc' ? ' ↓' : ' ↑') : '')

const num = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits })

const time = (stamp: string | null | undefined): string =>
  stamp && stamp.length > 10 ? stamp.slice(11, 16) : '—'
</script>

<template>
  <div>
    <PageHead :title="t('nav.data')" :back="`/accounts/${id}`">
      {{ t('data.lede') }}
      <NuxtLink to="/fields">{{ t('data.fieldsLink') }}</NuxtLink>
    </PageHead>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>

    <div class="tabs">
      <button
        v-for="item in TABS"
        :key="item.key"
        class="tab"
        :class="{ 'tab--on': tab === item.key }"
        type="button"
        @click="tab = item.key"
      >
        {{ t(`data.tab.${item.key}`) }}
      </button>
    </div>
    <p class="tiny" style="margin: -0.4rem 0 0.75rem">
      {{ t('data.healthNote') }}
    </p>

    <!-- ── фильтры ────────────────────────────────────────────────────────── -->
    <div class="card filters">
      <label v-if="tab !== 'products'" class="filter">
        <span>{{ t('common.from') }}</span>
        <DateField v-model="from" no-future />
      </label>
      <label v-if="tab !== 'products'" class="filter">
        <span>{{ t('common.to') }}</span>
        <DateField v-model="to" no-future />
      </label>

      <template v-if="tab === 'diary'">
        <label class="filter">
          <span>{{ t('data.filter.meal') }}</span>
          <select v-model="meal">
            <option value="">{{ t('data.filter.any') }}</option>
            <option v-for="(title, key) in MEALS" :key="key" :value="key">{{ title }}</option>
          </select>
        </label>
        <label class="filter">
          <span>{{ t('data.filter.kind') }}</span>
          <select v-model="kind">
            <option value="">{{ t('data.filter.any') }}</option>
            <option v-for="kind in KIND_KEYS" :key="kind" :value="kind">{{ t(`kind.${kind}`) }}</option>
          </select>
        </label>
      </template>

      <label v-if="tab === 'measurements'" class="filter">
        <span>Вид замера</span>
        <select v-model="measureKind">
          <option value="">{{ t('data.filter.any') }}</option>
          <option v-for="kind in MEASURE_KEYS" :key="kind" :value="kind">{{ t(`measure.${kind}`) }}</option>
        </select>
      </label>

      <label v-if="tab === 'diary' || tab === 'products'" class="filter filter--grow">
        <span>{{ t('data.searchByName') }}</span>
        <input v-model="search" type="text" :placeholder="t('data.search.placeholder')" />
      </label>

      <label v-if="tab === 'days'" class="check" style="align-self: flex-end; min-height: 44px">
        <input v-model="withFood" type="checkbox" />
        только дни с едой
      </label>
    </div>

    <!-- ── таблицы ────────────────────────────────────────────────────────── -->
    <div class="card">
      <div class="table-wrap">
        <table v-if="tab === 'diary'" class="data">
          <thead>
            <tr>
              <th class="sortable" @click="sortBy('date')">{{ t('data.col.date') }}{{ arrow('date') }}</th>
              <th>{{ t('data.col.time') }}</th>
              <th>{{ t('data.col.meal') }}</th>
              <th class="sortable" @click="sortBy('product')">{{ t('data.col.product') }}{{ arrow('product') }}</th>
              <th>{{ t('data.col.type') }}</th>
              <th class="num">{{ t('journal.col.amount') }}</th>
              <th class="num sortable" @click="sortBy('energy')">{{ t('data.col.kcal') }}{{ arrow('energy') }}</th>
              <th class="num">{{ t('macro.carbs.letter') }}</th>
              <th class="num">{{ t('macro.protein.letter') }}</th>
              <th class="num">{{ t('macro.fat.letter') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in diaryRows" :key="`${row.date}-${row.loggedAt}-${index}`">
              <td class="mono">{{ row.date }}</td>
              <td class="mono">{{ time(row.loggedAt) }}</td>
              <td>{{ row.meal ? pick(MEAL_TITLES[row.meal as MealKey]) : '' }}</td>
              <td style="white-space: normal">
                {{ row.name }}
                <span v-if="row.producer" class="tiny"> · {{ row.producer }}</span>
              </td>
              <td class="tiny">{{ t(`kind.${row.kind}`) }}</td>
              <td class="num mono">
                {{ num(row.amount, 1) }}<span v-if="row.serving" class="tiny"> {{ row.serving }}</span>
              </td>
              <td class="num mono">{{ num(row.energyKcal) }}</td>
              <td class="num mono">{{ num(row.carbsG, 1) }}</td>
              <td class="num mono">{{ num(row.proteinG, 1) }}</td>
              <td class="num mono">{{ num(row.fatG, 1) }}</td>
            </tr>
          </tbody>
        </table>

        <table v-else-if="tab === 'days'" class="data">
          <thead>
            <tr>
              <th class="sortable" @click="sortBy('date')">{{ t('data.col.date') }}{{ arrow('date') }}</th>
              <th class="num">Записей</th>
              <th class="num sortable" @click="sortBy('energy')">{{ t('data.col.kcal') }}{{ arrow('energy') }}</th>
              <th class="num">Цель</th>
              <th class="num">{{ t('macro.carbs.letter') }}</th>
              <th class="num">{{ t('macro.protein.letter') }}</th>
              <th class="num">{{ t('macro.fat.letter') }}</th>
              <th class="num">Шаги</th>
              <th class="num">Вода</th>
              <th class="num">Вес</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in dayRows" :key="row.date">
              <td class="mono">{{ row.date }}</td>
              <td class="num mono">{{ row.entries }}</td>
              <td class="num mono">{{ num(row.energyKcal) }}</td>
              <td class="num mono">{{ num(row.energyGoalKcal) }}</td>
              <td class="num mono">{{ num(row.carbsG, 1) }}</td>
              <td class="num mono">{{ num(row.proteinG, 1) }}</td>
              <td class="num mono">{{ num(row.fatG, 1) }}</td>
              <td class="num mono">{{ num(row.steps) }}</td>
              <td class="num mono">{{ num(row.waterMl) }}</td>
              <td class="num mono">{{ num(row.weightKg, 1) }}</td>
            </tr>
          </tbody>
        </table>

        <table v-else-if="tab === 'products'" class="data">
          <thead>
            <tr>
              <th class="sortable" @click="sortBy('name')">{{ t('data.col.product') }}{{ arrow('name') }}</th>
              <th>Категория</th>
              <th>Единица</th>
              <th class="num">Ккал/ед.</th>
              <th class="num sortable" @click="sortBy('entries')">{{ t('data.col.entries') }}{{ arrow('entries') }}</th>
              <th class="num sortable" @click="sortBy('energy')">{{ t('data.col.totalKcal') }}{{ arrow('energy') }}</th>
              <th>Последний раз</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in productRows" :key="row.productId">
              <td style="white-space: normal">
                {{ row.name || '—' }}
                <span v-if="row.producer" class="tiny"> · {{ row.producer }}</span>
              </td>
              <td class="tiny">{{ row.category || '—' }}</td>
              <td class="tiny">{{ row.baseUnit || '—' }}</td>
              <td class="num mono">{{ num(row.energyPerUnit, 2) }}</td>
              <td class="num mono">{{ row.entries }}</td>
              <td class="num mono">{{ num(row.totalEnergyKcal) }}</td>
              <td class="mono">{{ row.lastUsed || '—' }}</td>
            </tr>
          </tbody>
        </table>

        <table v-else-if="tab === 'health'" class="data">
          <thead>
            <tr>
              <th class="sortable" @click="sortBy('date')">{{ t('data.col.date') }}{{ arrow('date') }}</th>
              <th class="num">Шаги</th>
              <th class="num sortable" @click="sortBy('energy')">{{ t('data.col.active') }}{{ arrow('energy') }}</th>
              <th class="num">Базал.</th>
              <th class="num">Упражн.</th>
              <th class="num">Стоя</th>
              <th class="num">Км</th>
              <th class="num">Пульс покоя</th>
              <th class="num">ВСР</th>
              <th class="num">Сон, ч</th>
              <th class="num">Глуб.</th>
              <th class="num">Вес</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in healthRows" :key="row.date">
              <td class="mono">{{ row.date }}</td>
              <td class="num mono">{{ num(row.steps) }}</td>
              <td class="num mono">{{ num(row.activeKcal) }}</td>
              <td class="num mono">{{ num(row.basalKcal) }}</td>
              <td class="num mono">{{ num(row.exerciseMin) }}</td>
              <td class="num mono">{{ num(row.standHours) }}</td>
              <td class="num mono">{{ num(row.distanceKm, 1) }}</td>
              <td class="num mono">{{ num(row.restingHr) }}</td>
              <td class="num mono">{{ num(row.hrvMs) }}</td>
              <td class="num mono">{{ row.asleepMin === null ? '—' : (row.asleepMin / 60).toFixed(1) }}</td>
              <td class="num mono">{{ row.deepMin === null ? '—' : (row.deepMin / 60).toFixed(1) }}</td>
              <td class="num mono">{{ num(row.weightKg, 1) }}</td>
            </tr>
          </tbody>
        </table>

        <table v-else-if="tab === 'workouts'" class="data">
          <thead>
            <tr>
              <th class="sortable" @click="sortBy('date')">{{ t('data.col.date') }}{{ arrow('date') }}</th>
              <th>Начало</th>
              <th>{{ t('data.col.type') }}</th>
              <th class="num">Минут</th>
              <th class="num sortable" @click="sortBy('energy')">{{ t('data.col.kcal') }}{{ arrow('energy') }}</th>
              <th class="num">Км</th>
              <th>Источник</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in workoutRows" :key="`${row.startedAt}-${index}`">
              <td class="mono">{{ row.date }}</td>
              <td class="mono">{{ time(row.startedAt) }}</td>
              <td>{{ row.type }}</td>
              <td class="num mono">{{ num(row.durationMin) }}</td>
              <td class="num mono">{{ num(row.energyKcal) }}</td>
              <td class="num mono">{{ num(row.distanceKm, 2) }}</td>
              <td class="tiny">{{ row.source || '—' }}</td>
            </tr>
          </tbody>
        </table>

        <table v-else-if="tab === 'sleep'" class="data">
          <thead>
            <tr>
              <th class="sortable" @click="sortBy('date')">{{ t('data.col.night') }}{{ arrow('date') }}</th>
              <th>Уснули</th>
              <th>Встали</th>
              <th class="num sortable" @click="sortBy('energy')">{{ t('data.col.sleepHours') }}{{ arrow('energy') }}</th>
              <th class="num">Глубокий</th>
              <th class="num">REM</th>
              <th class="num">Основной</th>
              <th class="num">Просыпания</th>
              <th>Источник</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in sleepRows" :key="`${row.night}-${row.source}-${index}`">
              <td class="mono">{{ row.night }}</td>
              <td class="mono">{{ time(row.fellAsleepAt) }}</td>
              <td class="mono">{{ time(row.wokeAt) }}</td>
              <td class="num mono">{{ (row.asleepMin / 60).toFixed(1) }}</td>
              <td class="num mono">{{ (row.deepMin / 60).toFixed(1) }}</td>
              <td class="num mono">{{ (row.remMin / 60).toFixed(1) }}</td>
              <td class="num mono">{{ (row.coreMin / 60).toFixed(1) }}</td>
              <td class="num mono">{{ num(row.awakeMin) }}</td>
              <td class="tiny">{{ row.source }}</td>
            </tr>
          </tbody>
        </table>

        <table v-else class="data">
          <thead>
            <tr>
              <th class="sortable" @click="sortBy('date')">{{ t('data.col.date') }}{{ arrow('date') }}</th>
              <th>{{ t('data.col.time') }}</th>
              <th>{{ t('data.col.type') }}</th>
              <th class="num">Значение</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in measurementRows" :key="`${row.kind}-${row.loggedAt}-${index}`">
              <td class="mono">{{ row.date }}</td>
              <td class="mono">{{ time(row.loggedAt) }}</td>
              <td>{{ t(`measure.${row.kind}`) }}</td>
              <td class="num mono">{{ num(row.value, 1) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="!loading && total === 0" class="muted" style="margin: 1rem 0 0">
        Под эти условия ничего не попало. Если данных нет вовсе — запустите синхронизацию.
      </p>

      <DataPager
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
        :loading="loading"
      />
    </div>

    <FieldsHelp :doc="doc" />
  </div>
</template>

<style scoped>
th.sortable {
  cursor: pointer;
  user-select: none;
}
th.sortable:hover {
  color: var(--accent);
}
</style>
