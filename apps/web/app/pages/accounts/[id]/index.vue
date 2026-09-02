<script setup lang="ts">
import { BALANCE_EVEN_KCAL } from '@fatoff/contracts'
import type {
  AccountDto,
  AccountOverviewDto,
  PeriodSummaryDto,
  SyncRunDto,
} from '@fatoff/contracts'

/**
 * Обзор аккаунта.
 *
 * Только то, что показывает состояние: сводка, графики и короткое объяснение,
 * что лежит в каждом разделе. Управление — синхронизация, загрузка Apple Health,
 * доступ к аккаунту — переехало в свой раздел: обзор не должен быть местом, где
 * заодно нажимают кнопки.
 */
const api = useApi()
const route = useRoute()
const { t } = useI18n()
const id = route.params.id as string

const account = ref<AccountDto | null>(null)

/**
 * Сводка за период: сколько потрачено, сколько съедено, что из этого вышло.
 *
 * Считает сервер (D-082): те же числа показываются на «Дне целиком», и две
 * арифметики рано или поздно разошлись бы — на одном экране одно, на другом
 * другое.
 */
const summary = ref<PeriodSummaryDto | null>(null)
const from = ref('')
const to = ref('')
const loadingSummary = ref(false)

async function loadSummary(): Promise<void> {
  loadingSummary.value = true
  try {
    const query: Record<string, string> = {}
    if (from.value) query.from = from.value
    if (to.value) query.to = to.value

    summary.value = await api.get<PeriodSummaryDto>(
      `/accounts/${id}/summary?${new URLSearchParams(query).toString()}`,
    )
    // сервер сам решает, какой период взять, если даты не заданы: показываем его
    from.value = summary.value.from
    to.value = summary.value.to
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loadingSummary.value = false
  }
}

/** Быстрый выбор: последние N дней, считая сегодняшний. */
function lastDays(days: number): void {
  const iso = (at: Date): string =>
    `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))

  from.value = iso(start)
  to.value = iso(end)
  void loadSummary()
}

/**
 * Насколько полоска съеденного короче полоски расхода.
 *
 * Обе меряются от большего из двух, поэтому длинная всегда во всю ширину, а
 * короткая показывает разницу. Проценты считаются здесь, а не на сервере: это
 * вопрос картинки, а не данных.
 */
const barWidth = (value: number | null): string => {
  const eaten = summary.value?.eaten.avg ?? 0
  const burned = summary.value?.burned.avg ?? 0
  const top = Math.max(eaten, burned)
  if (!value || top <= 0) return '0%'
  return `${Math.round((value / top) * 100)}%`
}

/** Со знаком: «−348» читается как баланс, «348» — как непонятно что. */
const signed = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${num(Math.abs(value))}`
}

/** Занятий в неделю: «0.6 занятия в день» никому ничего не говорит. */
const perWeek = computed(() => {
  const days = summary.value?.days ?? 0
  if (days === 0) return '0'
  return ((summary.value!.workouts.count / days) * 7).toFixed(1)
})

const BALANCE_TONE: Record<string, string> = {
  deficit: 'chip--ok',
  even: 'chip--info',
  surplus: 'chip--warn',
}

/** Дефицит, профицит или «ровно» — по среднему балансу за период. */
const balanceState = computed(() => {
  const avg = summary.value?.balance.avg
  if (avg === null || avg === undefined) return null
  if (avg < -BALANCE_EVEN_KCAL) return 'deficit'
  if (avg > BALANCE_EVEN_KCAL) return 'surplus'
  return 'even'
})

/**
 * Имя аккаунта задаётся прямо здесь.
 *
 * Пока его нет, в заголовке стоит почта — а почта у входа через Apple ID
 * выглядит как `72xxxxxxxx@privaterelay.appleid.com` и именем не является
 * вовсе. Поле лежало в настройках синхронизации под словом «метка», и найти
 * его, чтобы просто дать аккаунту короткое имя, было неоткуда.
 */
const naming = ref(false)
const draftName = ref('')
const saving = ref(false)

function startNaming(): void {
  draftName.value = account.value?.label ?? ''
  naming.value = true
}

async function saveName(): Promise<void> {
  if (!account.value) return
  saving.value = true
  try {
    const label = draftName.value.trim() || null
    await api.patch(`/accounts/${id}`, { label, syncEnabled: account.value.syncEnabled })
    account.value = { ...account.value, label }
    naming.value = false
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}
const overview = ref<AccountOverviewDto | null>(null)
const runs = ref<SyncRunDto[]>([])
const error = ref('')

const SECTIONS = [
  { to: '/journal', key: 'nav.journal', note: 'section.journal', icon: 'calendar' },
  { to: '/planner', key: 'nav.planner', note: 'section.planner', icon: 'sliders' },
  { to: '/plans', key: 'nav.plans', note: 'section.plans', icon: 'archive' },
  { to: '/guide', key: 'nav.guide', note: 'section.guide', icon: 'info' },
  { to: '/data', key: 'nav.data', note: 'section.data', icon: 'search' },
  { to: '/sync', key: 'nav.sync', note: 'section.sync', icon: 'swap' },
  { to: '/export', key: 'nav.export', note: 'section.export', icon: 'save' },
]

const lastRun = computed(() => runs.value[0] ?? null)

const energySeries = computed(() =>
  (overview.value?.series ?? []).map((point) => ({ date: point.date, value: point.energyKcal })),
)
const weightSeries = computed(() =>
  (overview.value?.series ?? []).map((point) => ({ date: point.date, value: point.weightKg })),
)

onMounted(async () => {
  try {
    ;[account.value, overview.value, runs.value] = await Promise.all([
      api.get<AccountDto>(`/accounts/${id}`),
      api.get<AccountOverviewDto>(`/accounts/${id}/overview`),
      api.get<SyncRunDto[]>(`/accounts/${id}/sync?limit=1`),
    ])
    await loadSummary()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
})

const num = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits })

const when = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'
</script>

<template>
  <div v-if="account">
    <PageHead :title="account.label || account.email" :faint="!account.label" :back="'/'">
      <template #title-extra>
        <button class="btn btn--small name-btn" type="button" @click="startNaming">
          <AppIcon name="edit" :size="13" />
          {{ account.label ? t('overview.name.change') : t('overview.name.set') }}
        </button>
      </template>

      <span class="mono tiny email" :title="account.email">{{ account.email }}</span>
      · {{ t('overview.registered') }} {{ account.registrationDate || '—' }}
      · {{ account.storedDays }} {{ t('overview.storedDays') }}
      · {{ t('overview.lastSync') }}
      <template v-if="lastRun">
        {{ when(lastRun.startedAt) }}
        <span class="chip" :class="lastRun.status === 'done' ? 'chip--ok' : 'chip--warn'">
          {{ t(`sync.status.${lastRun.status}`) }}
        </span>
      </template>
      <template v-else>{{ t('overview.never') }}</template>
    </PageHead>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>

    <div v-if="naming" class="card">
      <label class="field" style="margin: 0 0 0.4rem">
        <span>{{ t('overview.name') }}</span>
        <input
          v-model="draftName"
          type="text"
          maxlength="64"
          :placeholder="t('overview.name.hint')"
          @keydown.enter.prevent="saveName"
        />
      </label>
      <p class="tiny muted">{{ t('overview.name.note') }}</p>
      <div class="row" style="gap: 0.4rem">
        <button class="btn btn--primary" type="button" :disabled="saving" @click="saveName">
          <AppIcon name="check" :size="14" /> {{ t('common.save') }}
        </button>
        <button class="btn" type="button" @click="naming = false">{{ t('common.cancel') }}</button>
      </div>
    </div>

    <!-- ── сводка за период ───────────────────────────────────────────────
      Раньше здесь стояли пять чисел без периода и без подписи, откуда они.
      Теперь период выбирается, а у каждого числа сказано, по скольким дням оно
      посчитано (D-082).
    -->
    <section class="card">
      <h2><AppIcon name="gauge" :size="16" /> {{ t('overview.summary') }}</h2>

      <div class="row row--wrap" style="gap: 0.5rem; align-items: flex-end">
        <label class="filter">
          <span>{{ t('common.from') }}</span>
          <DateField v-model="from" no-future />
        </label>
        <label class="filter">
          <span>{{ t('common.to') }}</span>
          <DateField v-model="to" no-future />
        </label>
        <div class="row" style="gap: 0.3rem">
          <button class="btn btn--small" type="button" @click="lastDays(7)">
            {{ t('common.week') }}
          </button>
          <button class="btn btn--small" type="button" @click="lastDays(30)">
            {{ t('common.month') }}
          </button>
          <button class="btn btn--small btn--primary" type="button" :disabled="loadingSummary" @click="loadSummary()">
            <span v-if="loadingSummary" class="spinner" />
            {{ t('common.apply') }}
          </button>
        </div>
      </div>

      <template v-if="summary && (summary.eaten.days > 0 || summary.burned.days > 0)">
        <div class="stats" style="margin-top: 0.9rem">
          <div>
            <div class="stat__value">{{ num(summary.burned.avg) }}</div>
            <div class="stat__label">
              <AppIcon name="flame" :size="12" /> {{ t('overview.period.burned') }}
            </div>
            <div class="tiny muted">{{ t('overview.period.days', { days: summary.burned.days, total: summary.days }) }}</div>
          </div>
          <div>
            <div class="stat__value">{{ num(summary.eaten.avg) }}</div>
            <div class="stat__label">
              <AppIcon name="meal" :size="12" /> {{ t('overview.period.eaten') }}
            </div>
            <div class="tiny muted">{{ t('overview.period.days', { days: summary.eaten.days, total: summary.days }) }}</div>
          </div>
          <div>
            <div class="stat__value">{{ signed(summary.balance.avg) }}</div>
            <div class="stat__label">{{ t('overview.period.balance') }}</div>
            <div class="tiny muted">{{ t('overview.period.days', { days: summary.balance.days, total: summary.days }) }}</div>
          </div>
        </div>

        <p class="period__verdict">
          <span v-if="balanceState" class="chip" :class="BALANCE_TONE[balanceState]">
            {{ t(`balance.${balanceState}`) }}
          </span>
          <span v-if="balanceState">
            {{ t(`overview.period.${balanceState}`, { value: num(Math.abs(summary.balance.avg ?? 0)) }) }}
          </span>
          <span v-else class="muted">{{ t('overview.period.noBalance') }}</span>
        </p>

        <!-- две полоски: короткая показывает, насколько съедено меньше расхода -->
        <div class="period__chart">
          <div class="period__row">
            <span class="period__label">{{ t('overview.period.eaten') }}</span>
            <span class="period__track"><span class="period__fill period__fill--eaten" :style="{ width: barWidth(summary.eaten.avg) }" /></span>
            <span class="period__value mono">{{ num(summary.eaten.avg) }}</span>
          </div>
          <div class="period__row">
            <span class="period__label">{{ t('overview.period.burned') }}</span>
            <span class="period__track"><span class="period__fill period__fill--burned" :style="{ width: barWidth(summary.burned.avg) }" /></span>
            <span class="period__value mono">{{ num(summary.burned.avg) }}</span>
          </div>
        </div>

        <h3 class="pane__title">{{ t('overview.progress') }}</h3>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th />
                <th>{{ t('overview.progress.avg') }}</th>
                <th>{{ t('overview.progress.total') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{{ t('overview.period.eaten') }}</td>
                <td class="mono">{{ num(summary.eaten.avg) }} {{ t('common.kcal') }}</td>
                <td class="mono">{{ num(summary.eaten.total) }}</td>
              </tr>
              <tr>
                <td>{{ t('overview.period.burned') }}</td>
                <td class="mono">{{ num(summary.burned.avg) }} {{ t('common.kcal') }}</td>
                <td class="mono">{{ num(summary.burned.total) }}</td>
              </tr>
              <tr>
                <td>{{ t('overview.period.balance') }}</td>
                <td class="mono">{{ signed(summary.balance.avg) }} {{ t('common.kcal') }}</td>
                <td class="mono">{{ signed(summary.balance.total) }}</td>
              </tr>
              <tr>
                <td>{{ t('macro.protein') }}</td>
                <td class="mono">{{ num(summary.proteinG.avg) }} {{ t('unit.g') }}</td>
                <td class="mono">{{ num(summary.proteinG.total) }}</td>
              </tr>
              <tr>
                <td>{{ t('overview.progress.workouts') }}</td>
                <td class="mono">{{ t('overview.progress.perWeek', { value: perWeek }) }}</td>
                <td class="mono">
                  {{ summary.workouts.count }} · {{ num(summary.workouts.minutes) }} {{ t('common.min') }}
                </td>
              </tr>
              <tr>
                <td>{{ t('overview.progress.activity') }}</td>
                <td class="mono">{{ num(summary.steps.avg) }} {{ t('overview.progress.steps') }}</td>
                <td class="mono">{{ num(summary.steps.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <p v-else class="muted">
        {{ t('overview.noData') }}
        <NuxtLink :to="`/accounts/${id}/sync`">{{ t('nav.sync') }}</NuxtLink>
      </p>
    </section>

    <template v-if="overview && overview.daysWithData > 0">
      <section class="card">
        <h2><AppIcon name="flame" :size="16" /> {{ t('overview.chart.energy') }}</h2>
        <MetricChart :points="energySeries" :reference="overview.avgEnergyGoalKcal" kind="bars" />
      </section>

      <section class="card">
        <h2><AppIcon name="target" :size="16" /> {{ t('overview.chart.weight') }}</h2>
        <MetricChart :points="weightSeries" kind="line" :digits="1" />
      </section>
    </template>

    <!-- ── разделы ────────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="info" :size="16" /> {{ t('overview.sections') }}</h2>
      <p class="tiny muted">{{ t('overview.sections.lede') }}</p>

      <div class="sections">
        <NuxtLink v-for="section in SECTIONS" :key="section.to" :to="`/accounts/${id}${section.to}`" class="section">
          <span class="section__head">
            <AppIcon :name="section.icon" :size="15" />
            <strong>{{ t(section.key) }}</strong>
          </span>
          <span class="tiny muted">{{ t(section.note) }}</span>
        </NuxtLink>
      </div>
    </section>
  </div>

  <p v-else class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>
</template>

<style scoped>
h2 {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr));
  gap: 0.6rem;
  margin-top: 0.8rem;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--sunk);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s, background 0.15s;
}
.section:hover {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
  background: var(--accent-bg);
}
.section__head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--ink);
}

/* почта — служебная строка: мелко, в одну строку и с многоточием */
.email {
  display: inline-block;
  max-width: min(100%, 22rem);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.name-btn {
  flex: none;
}

.period__verdict {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0.7rem 0 0.2rem;
  font-size: 0.9rem;
}

.period__chart {
  margin: 0.7rem 0 1.1rem;
}

/* сетка, а не флекс: у длинного слова в первой ячейке иначе едет вторая */
.period__row {
  display: grid;
  grid-template-columns: minmax(min(5.5rem, 30%), auto) 1fr auto;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.35rem;
  font-size: 0.86rem;
}

.period__track {
  height: 0.55rem;
  border-radius: 999px;
  background: var(--sunk);
  overflow: hidden;
}

.period__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
}

.period__fill--eaten {
  background: var(--accent);
}

.period__fill--burned {
  background: color-mix(in oklab, var(--accent) 45%, var(--ink-3));
}

.period__value {
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
</style>
